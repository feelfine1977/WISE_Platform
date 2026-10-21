// The built browser through the import wizard (#4), on a laptop-sized window: the guide reads a packaged synthetic
// example; an invented CSV is read with a wrong delimiter and corrected, its roles chosen, read and confirmed by keyboard,
// summarised in "What WISE understood" and opened; its complete records are read by keyboard and pointer; the
// investigation is saved; a corrected reading is published as a new preparation, and the saved investigation reopens
// with its own. A malformed CSV is then read and never published. Every expectation comes from the independent oracle
// tests/fixtures/import-journey/expected.json. Only checks and identities are written; never a path or a cell.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const {journey, broken} = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
// A common laptop: the final review action must stay reachable at this size.
const viewport = {width: 1366, height: 768};
const page = await browser.newPage({viewport});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const origin = new URL(base).origin;
const errors = [], elsewhere = [], evidence = {};
let population = null, reopened = null;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).origin !== origin) elsewhere.push(new URL(request.url()).origin); });
page.on('response', async response => {
  const path = new URL(response.url()).pathname;
  if (!response.ok() || response.request().method() !== 'POST') return;
  // A reply that arrives while the browser closes after a failed check is not read; the failed check is what is reported.
  const body = () => response.json().catch(() => null);
  if (path === '/api/investigations/case-evidence') { const answer = await body(); if (answer) evidence[answer.case_id] = answer; }
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const areas = page.getByRole('navigation', {name: 'Areas'});
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const count = (n, unit) => `${n.toLocaleString('en')} ${n === 1 ? unit : unit + 's'}`;

async function answered(path, action) {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST'), action()]);
  return response;
}

/** Presses a button from the keyboard: focus, then Enter. */
async function press(locator, key = 'Enter') {
  await locator.focus();
  await page.keyboard.press(key);
}

/** The columns of the sample as read, without its first column, the source position; -1 while there is no sample. */
function sampleColumns() {
  const table = [...document.querySelectorAll('table')].find(element => element.caption?.textContent?.startsWith('The first records as read'));
  return table ? table.querySelectorAll('thead th').length - 1 : -1;
}
const columnsShown = () => page.evaluate(sampleColumns);
const columnsBecome = n => page.waitForFunction(`(${sampleColumns.toString()})() === ${n}`);

/** Chooses the column of a role by the column's name, whatever the evidence the option adds after it. */
async function role(label, column) {
  const select = page.getByLabel(label, {exact: true});
  const value = await select.evaluate((element, name) => [...element.options].find(option => option.text.startsWith(`${name} — `))?.value, column);
  assert.ok(value !== undefined, `${label}: no option for ${column}`);
  await select.selectOption(value);
}

async function choose(file) {
  for (const [label, column] of Object.entries(journey.roles)) await role(label, column);
  const context = page.getByRole('group', {name: 'Context attributes (optional)'});
  for (const box of await context.getByRole('checkbox').all()) {
    const name = ((await box.evaluate(element => element.closest('label')?.textContent ?? '')) || '').split(' — ')[0].trim();
    const wanted = journey.context.includes(name);
    if ((await box.isChecked()) !== wanted) await box.setChecked(wanted);
  }
  await page.getByRole('radio', {name: new RegExp(`^${escape(journey.time_format)}`)}).check();
  await page.getByRole('radio', {name: 'As recorded: no zone is applied'}).check();
  await useProposal();
}

/** The cutoff proposed from the data: filled in by itself unless the analyst changed it; taken over where it was not. */
async function useProposal() {
  await page.getByRole('status').filter({hasText: /^Proposed from the data:/}).waitFor();
  const use = page.getByRole('button', {name: 'Use the proposal', exact: true});
  if (await use.count()) await use.click();
  await page.getByRole('button', {name: 'Use the proposal', exact: true}).waitFor({state: 'detached'});
}

function figures(region) {
  return region.evaluate(element => Object.fromEntries([...element.querySelectorAll('dl.report-figures > div')].map(row =>
    [row.querySelector('dt')?.textContent ?? '', row.querySelector('dd')?.textContent ?? ''])));
}

async function read(state) {
  await press(page.getByRole('button', {name: 'Read the source with these choices', exact: true}));
  const summary = page.getByRole('region', {name: 'What WISE understood'});
  await summary.waitFor();
  await page.getByRole('status').filter({hasText: state}).waitFor();
  return summary;
}

async function upload(path, filename) {
  await page.getByLabel('Add an event-history CSV').setInputFiles(path);
  await page.getByRole('heading', {name: `How ${filename} is written`}).waitFor();
  await page.waitForFunction(`(${sampleColumns.toString()})() > 0`).catch(async error => {
    if (process.env.WISE_BROWSER_DUMP_TEXT) await writeFile(process.env.WISE_BROWSER_DUMP_TEXT, (await page.locator('main').first().textContent()) ?? '');
    throw error;
  });
  await page.getByLabel('Case id', {exact: true}).waitFor();
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();

  // The guide names the roles and options, and reads a packaged synthetic example through the ordinary operations.
  await page.getByText('How WISE reads a CSV file', {exact: true}).click();
  const guide = page.locator('details.import-guide');
  const guideText = (await guide.textContent()) ?? '';
  check('guide_names_the_roles_and_options', ['Case id', 'Activity', 'Time', 'Sequence number (optional)', 'Context attributes (optional)',
    'Semicolon ;', 'Windows-1252', journey.time_format, 'Each row of the file is one recorded event or change'].every(text => guideText.includes(text)), null);
  await press(guide.getByRole('button', {name: 'Load the synthetic example and read it', exact: true}));
  const example = page.getByRole('region', {name: 'What WISE understood'});
  await example.waitFor();
  check('guide_example_has_an_actual_report', ((await example.textContent()) ?? '').includes(`read from ${config.guide_example_file}`), await example.textContent());

  // A wrong delimiter: the file falls into one column, nothing can be read, and the delimiter is corrected in place.
  await upload(config.files.journey, journey.file);
  check('delimiter_detected', (await page.getByLabel('Delimiter', {exact: true}).evaluate(element => element.selectedOptions[0].text)).startsWith(journey.delimiter), null);
  check('detected_columns', await columnsShown() === journey.columns.length, await columnsShown());
  await answered('/api/sources/inspect', () => page.getByLabel('Delimiter', {exact: true}).selectOption(','));
  await columnsBecome(1);
  check('wrong_delimiter_gives_one_column', await columnsShown() === 1, await columnsShown());
  check('wrong_delimiter_cannot_be_read', await page.getByRole('button', {name: 'Read the source with these choices', exact: true}).isDisabled(), null);
  await answered('/api/sources/inspect', () => page.getByLabel('Delimiter', {exact: true}).selectOption(';'));
  await columnsBecome(journey.columns.length);
  check('corrected_delimiter_gives_every_column', await columnsShown() === journey.columns.length, await columnsShown());

  // Roles, times and cutoff; then the reading and its confirmation, by keyboard.
  await choose();
  let summary = await read('Some rows have issues');
  check('report_takes_the_focus', await page.evaluate(() => document.activeElement?.textContent) === 'What WISE understood', null);
  const report = page.locator('.report');
  const shown = await figures(report);
  const expectedFigures = {'Records read': count(journey.records_read, 'record'), 'With an incident id': count(journey.with_incident_id, 'record'),
    'Outside every incident': count(journey.outside, 'record'), 'With a usable time': count(journey.usable_times, 'record'),
    'Without a usable time: kept, order not known': count(journey.unusable_times, 'record'), Incidents: count(journey.incidents, 'incident'),
    'Incidents in a known order': count(journey.known_order_incidents, 'incident'), 'Incidents in an order not fully known': count(journey.unknown_order_incidents, 'incident'),
    'Records without activity label': count(journey.without_activity_label, 'record')};
  check('report_figures_match_the_oracle', Object.entries(expectedFigures).every(([label, value]) => shown[label] === value), shown);
  const issuePositions = (await report.locator('.issues .issue-positions').allTextContents()).sort();
  const expectedPositions = Object.values(journey.issues).map(positions => `Source position${positions.length === 1 ? '' : 's'} ${positions.join(', ')}`).sort();
  check('issues_name_their_rows', JSON.stringify(issuePositions) === JSON.stringify(expectedPositions), issuePositions);
  const outside = (await page.getByRole('table', {name: 'Records outside every case, as written in the file'}).textContent()) ?? '';
  check('rows_outside_keep_their_original_text', outside.includes(journey.outside_original_text), null);
  let understood = (await summary.textContent()) ?? '';
  check('summary_reconciles_the_records', understood.includes(`${count(journey.records_read, 'record')} read from ${journey.file}: ${count(journey.with_incident_id, 'record')} in ${count(journey.incidents, 'incident')}, and ${count(journey.outside, 'record')} outside every case.`), understood);
  const roles = await figures(summary);
  check('summary_names_each_role', Object.entries(journey.roles).every(([label, column]) => (roles[label] ?? '').startsWith(`“${column}”`))
    && journey.context.every(column => (roles['Context attributes'] ?? '').includes(`“${column}”`)), roles);
  check('summary_explains_empty_and_literal_values', understood.includes('such as 0, False or Unknown, is kept exactly as written and is never read as missing'), null);
  check('summary_waits_for_the_confirmation', roles.Preparation === 'given once the rows with issues are confirmed', roles.Preparation);
  check('no_one_record_note', !understood.includes('Every case has exactly one record'), null);
  await press(page.getByRole('checkbox', {name: 'I have read the rows with issues; keep them as described above.'}), 'Space');
  await press(page.getByRole('button', {name: 'Confirm and prepare', exact: true}));
  await page.getByRole('status').filter({hasText: 'Ready: the source is read with these choices'}).waitFor();
  summary = page.getByRole('region', {name: 'What WISE understood'});
  const first = (await figures(summary)).Preparation;
  check('confirmed_reading_names_its_preparation', /^preparation\.v1:sha256:[0-9a-f]{64}$/.test(first), first);
  check('confirmation_returns_the_focus_to_the_summary', await page.evaluate(() => document.activeElement?.textContent) === 'What WISE understood', null);

  // On a laptop the final action stays reachable, and the long column name does not widen the page.
  const open = page.getByRole('button', {name: 'Open cases', exact: true});
  await open.scrollIntoViewIfNeeded();
  const box = await open.boundingBox();
  check('final_action_within_a_laptop_window', box && box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height, box);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('long_column_name_does_not_widen_the_page', overflow <= 1, overflow);

  // The incidents of this reading, and every record of two of them, by keyboard and by pointer.
  population = await (await answered('/api/investigations/open-population', () => press(open))).json();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  check('opened_population_is_the_confirmed_reading', population?.identity?.preparation_id === first && population.population.case_count === journey.incidents
    && JSON.stringify(population.population.case_ids) === JSON.stringify(journey.case_ids), population?.population);
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Cases', exact: true}).click();
  const rowButton = id => page.locator('table tbody tr button.row-open', {hasText: new RegExp(`^${escape(id)}$`)}).first();
  await rowButton(journey.case_ids[0]).focus();
  for (let step = 0; step < journey.case_ids.indexOf(journey.missing_value_of.case); step++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const keyboardList = page.getByRole('list', {name: `Records of case ${journey.missing_value_of.case} in the declared order`});
  await keyboardList.waitFor();
  check('keyboard_opens_every_record', await keyboardList.getByRole('listitem').count() === journey.case_records[journey.missing_value_of.case], null);
  const gruppe = journey.columns.indexOf(journey.missing_value_of.column);
  const missingRecord = evidence[journey.missing_value_of.case]?.records.find(record => record.source_position === journey.missing_value_of.position);
  check('empty_cell_stays_missing', missingRecord && missingRecord.context.find(value => value.column_index === gruppe)?.value === null
    && missingRecord.original_cells[gruppe] === '', missingRecord?.context);
  await press(page.getByRole('button', {name: 'Return to cases', exact: true}));
  await page.waitForFunction(id => document.activeElement?.textContent === id, journey.missing_value_of.case);
  check('return_puts_the_focus_back_on_the_incident', true, null);
  await rowButton(journey.literal_values_of.case).click();
  const pointerList = page.getByRole('list', {name: `Records of case ${journey.literal_values_of.case} in the declared order`});
  await pointerList.waitFor();
  check('pointer_opens_every_record', await pointerList.getByRole('listitem').count() === journey.case_records[journey.literal_values_of.case], null);
  const literalColumn = journey.columns.indexOf(journey.literal_values_of.column);
  const literals = (evidence[journey.literal_values_of.case]?.records ?? []).map(record => record.context.find(value => value.column_index === literalColumn)?.value);
  check('literal_zero_false_unknown_kept_as_written', JSON.stringify(literals) === JSON.stringify(journey.literal_values_of.values), literals);

  // The investigation is saved on this reading.
  await page.getByRole('button', {name: 'Return to cases', exact: true}).click();
  await page.getByRole('button', {name: 'Save', exact: true}).first().click();
  const form = page.locator('#saved-form');
  await form.getByLabel('Name').fill(config.saved_name);
  const saved = await answered('/api/investigations/save', () => form.getByRole('button', {name: 'Save', exact: true}).click());
  check('investigation_saved', saved.status() === 200, saved.status());
  await form.getByRole('button', {name: 'Close', exact: true}).click();

  // A corrected reading: the same source with one fixed offset. It is previewed, confirmed and published anew.
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('radio', {name: 'One fixed offset for every time'}).check();
  await page.getByLabel('Offset from UTC', {exact: true}).selectOption(String(config.corrected_offset_minutes));
  await useProposal();
  await read('Some rows have issues');
  await press(page.getByRole('checkbox', {name: 'I have read the rows with issues; keep them as described above.'}), 'Space');
  await press(page.getByRole('button', {name: 'Confirm and prepare', exact: true}));
  await page.getByRole('status').filter({hasText: 'Ready: the source is read with these choices'}).waitFor();
  const second = (await figures(page.getByRole('region', {name: 'What WISE understood'}))).Preparation;
  check('corrected_reading_is_a_new_preparation', /^preparation\.v1:sha256:[0-9a-f]{64}$/.test(second) && second !== first, [first, second]);
  population = await (await answered('/api/investigations/open-population', () => press(page.getByRole('button', {name: 'Open cases', exact: true})))).json();
  check('corrected_reading_opens', population?.identity?.preparation_id === second, population?.identity);

  // The saved investigation reopens on its own reading.
  await areas.getByRole('button', {name: 'Saved', exact: true}).click();
  reopened = await (await answered('/api/investigations/reopen', () => page.getByRole('button', {name: `Reopen ${config.saved_name}`, exact: true}).click())).json();
  check('saved_investigation_keeps_its_preparation', reopened?.revision?.content?.base_identity?.preparation_id === first
    && reopened?.restored_selection?.identity?.preparation_id === first, reopened?.restored_selection?.identity);

  // A malformed file: its inspection says why no reading fits; choosing the delimiter by hand gives no reading to open either.
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByLabel('Add an event-history CSV').setInputFiles(config.files.broken);
  await page.getByRole('heading', {name: `How ${broken.file} is written`}).waitFor();
  const refusedInspection = page.getByText(/exceeding the supported 5% maximum/);
  await refusedInspection.waitFor();
  check('malformed_file_refused_in_words', ((await page.locator('main').first().textContent()) ?? '').includes(`${broken.ragged_records} of ${broken.records_read} nonblank source records are ragged`), null);
  await answered('/api/sources/inspect', () => page.getByLabel('Delimiter', {exact: true}).selectOption(';'));
  const readButton = page.getByRole('button', {name: 'Read the source with these choices', exact: true});
  if (await page.getByLabel('Case id', {exact: true}).count()) {
    await choose();
    await press(readButton);
    await page.getByRole('alert').filter({hasText: 'The source cannot be read with these choices'})
      .or(page.getByRole('status').filter({hasText: 'The source cannot be prepared with these choices'})).first().waitFor();
  } else {
    await refusedInspection.waitFor();
    check('malformed_file_cannot_be_read_by_hand', (await readButton.count()) === 0 || (await readButton.isDisabled()), null);
  }
  check('malformed_file_not_offered_for_opening', await page.getByRole('button', {name: 'Open cases', exact: true}).count() === 0, null);

  check('nothing_requested_from_elsewhere', elsewhere.length === 0, [...new Set(elsewhere)]);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks, first_preparation_id: first, corrected_preparation_id: second, population: population?.identity ?? null}));
} finally {
  await browser.close();
}
