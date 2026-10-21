// The built browser through the chronology of an invented source (#5): the reading's summary names its clock, order and
// policies; the evidence of a tied incident whose sequence numbers disagree with its times, of one with missing labels and
// of one with a date-only time is read by keyboard; the map's path over missing labels says what it passes over and no
// end is made after an unlabelled last record; a reading without the sequence number is compared with the first and
// published as its own preparation. In the phase "reopen", after the service was restarted, the first preparation is
// opened again and keeps its order. Every expectation comes from tests/fixtures/chronology/expected.json.
// Only checks and identities are written.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath, phase] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 768}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], evidence = {};
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  if (new URL(response.url()).pathname !== '/api/investigations/case-evidence' || !response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (answer) evidence[answer.case_id] = answer;
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const areas = page.getByRole('navigation', {name: 'Areas'});
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const columns = ['Ticket', 'Status', 'At', 'Seq', 'Desk'];

async function answered(path, action) {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST'), action()]);
  return response;
}
async function press(locator, key = 'Enter') { await locator.focus(); await page.keyboard.press(key); }
async function role(label, column) {
  const select = page.getByLabel(label, {exact: true});
  const value = await select.evaluate((element, name) => [...element.options].find(option => option.text.startsWith(`${name} — `))?.value, column);
  assert.ok(value !== undefined, `${label}: no option for ${column}`);
  await select.selectOption(value);
}
async function useProposal() {
  await page.getByRole('status').filter({hasText: /^Proposed from the data:/}).waitFor();
  const use = page.getByRole('button', {name: 'Use the proposal', exact: true});
  if (await use.count()) await use.click();
  await use.waitFor({state: 'detached'});
}
function figures(region) {
  return region.evaluate(element => Object.fromEntries([...element.querySelectorAll('dl.report-figures > div')].map(row =>
    [row.querySelector('dt')?.textContent ?? '', row.querySelector('dd')?.textContent ?? ''])));
}
async function readAndConfirm() {
  await press(page.getByRole('button', {name: 'Read the source with these choices', exact: true}));
  await page.getByRole('region', {name: 'What WISE understood'}).waitFor();
  await page.getByRole('status').filter({hasText: 'Some rows have issues'}).waitFor();
  const summary = await figures(page.getByRole('region', {name: 'What WISE understood'}));
  const issues = (await page.locator('.issues').textContent()) ?? '';
  const compared = await page.getByRole('table', {name: 'Compared with the previous reading of this source'}).count()
    ? await page.getByRole('table', {name: 'Compared with the previous reading of this source'}).evaluate(table =>
      Object.fromEntries([...table.querySelectorAll('tbody tr')].map(row => [row.querySelector('th').textContent, [...row.querySelectorAll('td')].map(cell => cell.textContent)])))
    : null;
  await press(page.getByRole('checkbox', {name: 'I have read the rows with issues; keep them as described above.'}), 'Space');
  await press(page.getByRole('button', {name: 'Confirm and prepare', exact: true}));
  await page.getByRole('status').filter({hasText: 'Ready: the source is read with these choices'}).waitFor();
  const preparation = (await figures(page.getByRole('region', {name: 'What WISE understood'}))).Preparation;
  return {summary, issues, compared, preparation};
}
async function openIncident(caseId, byKeyboard) {
  const row = page.locator('table tbody tr button.row-open', {hasText: new RegExp(`^${escape(caseId)}$`)}).first();
  if (byKeyboard) await press(row); else await row.click();
  const list = page.getByRole('list', {name: `Records of case ${caseId} in the declared order`});
  await list.waitFor();
  return list;
}
/** The source positions of an incident's records as the evidence view lists them. */
async function positionsShown(list) {
  return (await list.getByRole('listitem').allTextContents()).map(text => Number(/source position (\d+)/.exec(text)?.[1]));
}
async function incidentsView() {
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Cases', exact: true}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  if (phase === 'review') {
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    await page.getByLabel('Add an event-history CSV').setInputFiles(config.file);
    await page.getByRole('heading', {name: `How ${expected.file} is written`}).waitFor();
    await page.getByLabel('Case id', {exact: true}).waitFor();
    await role('Case id', columns[expected.mapping.case_column]);
    await role('Activity', columns[expected.mapping.activity_column]);
    await role('Time', columns[expected.mapping.timestamp_column]);
    await role('Sequence number (optional)', columns[expected.mapping.sequence_column]);
    const context = page.getByRole('group', {name: 'Context attributes (optional)'});
    for (const box of await context.getByRole('checkbox').all()) {
      const name = ((await box.evaluate(element => element.closest('label')?.textContent ?? '')) || '').split(' — ')[0].trim();
      const wanted = expected.mapping.context_columns.map(index => columns[index]).includes(name);
      if ((await box.isChecked()) !== wanted) await box.setChecked(wanted);
    }
    await page.getByRole('radio', {name: /^Year-Month-Day, ISO 8601/}).check();
    await page.getByRole('radio', {name: /^Offsets written in the values/}).check();
    await useProposal();
    const first = await readAndConfirm();
    check('summary_names_the_order_authority', first.summary.Order.includes('by the sequence number, then their place in the file')
      && first.summary.Order.includes('the time decides') && first.summary.Order.includes('not fully known'), first.summary.Order);
    check('summary_names_the_clock', first.summary.Clock === 'instants in UTC: a duration is elapsed time', first.summary.Clock);
    check('summary_names_the_cutoff_and_its_provenance', first.summary['Export taken at'].endsWith('proposed from the latest usable time'), first.summary['Export taken at']);
    check('summary_names_the_policy_versions', /\.v\d+$/.test(first.summary['Order policy'] ?? '') && /\.v\d+$/.test(first.summary['Activity label policy'] ?? ''), first.summary);
    check('disagreement_named_with_its_rows', first.issues.includes('Time and sequence number disagree: time decides')
      && first.issues.includes(`Source positions ${expected.issues.timestamp_sequence_disagreement.join(', ')}`), first.issues);
    check('first_reading_has_nothing_to_compare', first.compared === null, first.compared);
    check('first_preparation_named', /^preparation\.v1:sha256:[0-9a-f]{64}$/.test(first.preparation), first.preparation);

    await answered('/api/investigations/open-population', () => press(page.getByRole('button', {name: 'Open cases', exact: true})));
    await incidentsView();
    // A tie whose sequence numbers disagree with the times: listed in the declared order, with the rule in words.
    let list = await openIncident('T-1', true);
    check('tie_in_the_declared_order', JSON.stringify(await positionsShown(list)) === JSON.stringify(expected.cases['T-1'].order), await positionsShown(list));
    const ruleText = (await page.locator('p.order-rule').textContent()) ?? '';
    check('evidence_names_the_order_rule', ruleText.includes('by their sequence number, then by their place in the file') && ruleText.includes('the time decides'), ruleText);
    check('evidence_names_equal_times', ((await page.locator('main').first().textContent()) ?? '').includes('the same recorded time'), null);
    await press(page.getByRole('button', {name: 'Return to cases', exact: true}));
    await page.waitForFunction(() => document.activeElement?.textContent === 'T-1');
    check('return_restores_the_focused_row', true);
    // Missing labels: the records stay, said to have no label.
    list = await openIncident('T-2', true);
    const unlabelled = (await list.getByRole('listitem').allTextContents()).filter(text => text.includes('no activity label')).length;
    check('unlabelled_records_kept_and_named', unlabelled === expected.cases['T-2'].omitted.length
      && JSON.stringify(await positionsShown(list)) === JSON.stringify(expected.cases['T-2'].order), unlabelled);
    await press(page.getByRole('button', {name: 'Return to cases', exact: true}));
    // A date without a time: not readable, never midnight; the incident's order is said not to be fully known.
    list = await openIncident('T-3', false);
    const t3 = (await page.locator('main').first().textContent()) ?? '';
    check('date_only_time_not_readable', (await list.getByRole('listitem').allTextContents()).some(text => text.includes('time not readable'))
      && evidence['T-3']?.records.find(record => record.source_position === expected.issues.invalid_timestamp[0])?.utc_instant === null, null);
    check('order_not_fully_known_said', t3.includes('The order of this case is not fully known'), null);
    check('untimed_record_follows_the_timed', JSON.stringify(await positionsShown(list)) === JSON.stringify(expected.cases['T-3'].order), await positionsShown(list));
    await page.getByRole('button', {name: 'Return to cases', exact: true}).click();

    // The map's path over missing labels says so in its step; no end follows an unlabelled last record.
    await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Paths', exact: true}).click();
    const paths = page.getByRole('table', {name: 'Paths of the kept cases'});
    await paths.waitFor();
    await paths.getByRole('button', {name: 'Path from “Opened” to “Resolved”', exact: true}).click();
    check('bridged_path_step_says_what_it_passes_over',
      await page.getByRole('button', {name: 'Keep cases where “Resolved” directly follows “Opened” in the activity sequence, records without activity label between them passed over', exact: true}).count() === 1, null);
    // T-1 ends with a labelled record, so its end is drawn; T-2's last record has no label, so none is made for "Resolved".
    check('end_drawn_after_a_labelled_last_record', await paths.getByRole('button', {name: 'Flow from “Assigned” to End', exact: true}).count() === 1, null);
    check('no_end_after_an_unlabelled_last_record', await paths.getByRole('button', {name: 'Flow from “Resolved” to End', exact: true}).count() === 0, null);

    // Back in the Data area the focus is on the control the incidents were opened from.
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-open-place') === 'report');
    check('data_area_returns_the_focus_to_the_preparation_control', await page.evaluate(() => document.activeElement?.getAttribute('data-open-preparation')) === first.preparation, null);

    // Without the sequence number: compared with the first reading, then published as its own preparation.
    await page.getByLabel('Sequence number (optional)', {exact: true}).selectOption('');
    await useProposal().catch(() => undefined);
    const second = await readAndConfirm();
    check('change_is_compared_with_the_first_reading', second.compared !== null && second.compared['Incidents in a known order']?.[0] === `${expected.report.sequence_evaluable_case_count} cases`, second.compared);
    check('summary_without_sequence_names_file_order', second.summary.Order.startsWith('by the usable time; records with the same time by their place in the file'), second.summary.Order);
    check('second_is_a_new_preparation', /^preparation\.v1:sha256:[0-9a-f]{64}$/.test(second.preparation) && second.preparation !== first.preparation, [first.preparation, second.preparation]);
    await answered('/api/investigations/open-population', () => press(page.getByRole('button', {name: 'Open cases', exact: true})));
    await incidentsView();
    list = await openIncident('T-1', true);
    check('second_reading_orders_ties_by_file_place', JSON.stringify(await positionsShown(list)) === JSON.stringify(expected.without_sequence['T-1'].order), await positionsShown(list));
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks, first_preparation_id: first.preparation, second_preparation_id: second.preparation}));
  } else {
    // A new service process and a fresh browser: the first preparation opens with its own order.
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    const prepared = page.getByRole('table', {name: 'Prepared readings in this workspace'});
    await prepared.waitFor();
    const opened = await (await answered('/api/investigations/open-population', () =>
      prepared.getByRole('button', {name: new RegExp(`preparation ${escape(config.first_preparation_id)}$`)}).click())).json();
    check('first_preparation_reopens', opened.identity.preparation_id === config.first_preparation_id, opened.identity);
    await incidentsView();
    const list = await openIncident('T-1', true);
    check('first_preparation_keeps_its_order', JSON.stringify(await positionsShown(list)) === JSON.stringify(expected.cases['T-1'].order), await positionsShown(list));
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks, identity: opened.identity}));
  }
} finally {
  await browser.close();
}
