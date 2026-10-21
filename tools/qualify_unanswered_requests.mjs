// The built browser through requests without a later answer (#66) over the invented tests/fixtures/requests file.
// Phase "define": in the Requests tab of the side panel the request activities are proposed from the observed values of
// the Turn column and used, the answer chosen and a 72-hour gap given; the definition is said in words and read only once
// reviewed; the incidents are those of the hand-written expected.json, with their last request, the records after it and
// the hours from their last record to the cutoff accepted at import; the history of one opens with its last request marked
// and the keyboard returns to it; a changed definition asks for a new review; nothing is called resolved; the reviewed
// definition is saved with the investigation. Phase "reopen", after an actual restart in a browser that kept nothing: the
// definition comes back from the saved investigation and reads the same incidents.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath, phase] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const NAME = 'Invented requests';
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await (await browser.newContext({viewport: {width: 1440, height: 900}})).newPage();
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const {formatHours} = await import(new URL('../node_modules/wise-flow/dist/core/format.js', import.meta.url).href);
const errors = [], asked = [], answers = [], saves = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const path = new URL(request.url()).pathname;
  if (path === '/api/investigations/unanswered-requests') asked.push(request.postDataJSON());
  if (path === '/api/investigations/save') saves.push(request.postDataJSON());
});
page.on('response', async response => {
  if (new URL(response.url()).pathname === '/api/investigations/unanswered-requests' && response.ok()) answers.push(await response.json());
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const areas = page.getByRole('navigation', {name: 'Areas'});
const panel = () => page.locator('.requests-panel');

async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
async function openRequests() {
  if (!(await page.locator('#explorer-rail').count())) await page.getByRole('button', {name: 'Filters and views', exact: true}).click();
  await page.getByRole('group', {name: 'Side panel'}).getByRole('button', {name: 'Requests', exact: true}).click();
  await panel().waitFor();
}
/** Finds the incidents and checks them against a part of the oracle. */
async function find(name) {
  const before = answers.length;
  await panel().getByRole('button', {name: 'Find the cases', exact: true}).click();
  for (let wait = 0; wait < 600 && answers.length === before; wait += 1) await page.waitForTimeout(100);
  const wanted = expected[name];
  check(`${name}_definition_sent_as_reviewed`, same(asked.at(-1).definition, wanted.definition), asked.at(-1).definition);
  const answer = answers.at(-1);
  check(`${name}_outcomes_as_the_oracle`, same(answer.outcomes, wanted.outcomes), answer.outcomes);
  const table = panel().getByRole('table', {name: 'Cases whose last request has no later answer'});
  await table.waitFor();
  const rows = await table.locator('tbody tr').evaluateAll(items => items.map(row => Array.from(row.children, cell => cell.textContent)));
  const time = text => `${text.slice(0, 16).replace('T', ' ')} UTC`;
  const want = wanted.cases.map(item => [item.case_id, `“Asked customer”, record ${item.position}, ${time(answer.cases.find(found => found.case_id === item.case_id).last_request.time)}`,
    `${item.records_after_request}, no answer`, time(item.last_record_time), formatHours(item.hours, 'en')]);
  check(`${name}_incidents_and_evidence_as_the_oracle`, same(rows, want), {rows, want});
  return answer;
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  if (phase === 'define') {
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
    await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, expected.incidents.length);
    await settled(0);
    await openRequests();
    const findButton = panel().getByRole('button', {name: 'Find the cases', exact: true});
    check('nothing_read_before_a_definition', await findButton.isDisabled() && asked.length === 0, null);

    // ---- proposed from the observed values of the turn column, used, completed and reviewed ----
    await panel().getByLabel('Turn column').selectOption({label: 'Turn'});
    await panel().getByRole('button', {name: 'Read the values of this column', exact: true}).click();
    await panel().getByLabel(/A request counts while the turn is/).selectOption('Customer');
    const proposal = (await panel().locator('.requests-proposal').textContent()) ?? '';
    check('requests_proposed_from_observed_values', proposal.includes('“Asked customer” (6 of 7 records)') && !proposal.includes('“Opened”'), proposal);
    await panel().getByRole('button', {name: 'Use the proposal as the request activities', exact: true}).click();
    await panel().getByRole('group', {name: 'Answer activities'}).getByRole('checkbox', {name: 'Customer replied', exact: true}).check();
    await panel().getByLabel(/starts a new matter after a gap/).fill('72');
    const words = (await panel().locator('.requests-words p').textContent()) ?? '';
    check('definition_said_in_words', words === 'A request is a record of “Asked customer” recorded while Turn is “Customer”; an answer is a record of “Customer replied”. A record more than 72 hours after the record before it starts a new matter, and only the latest matter of a case is read. A case is listed when its last request in that matter has no later answer in the records of the export.', words);
    check('not_read_before_review', await findButton.isDisabled() && asked.length === 0, null);
    await panel().getByRole('checkbox', {name: /I have reviewed this definition/}).check();
    const first = await find('with_turn_and_gap');
    const limits = (await panel().locator('.requests-result .limitation').textContent()) ?? '';
    check('hours_basis_and_cutoff_disclosed', limits.includes('to the export cutoff accepted at import, 2026-10-20 00:00 UTC') && limits.includes('It is not a waiting time')
      && first.clock.snapshot_cutoff === expected.cutoff_utc, limits);
    const result = (await panel().locator('.requests-result').textContent()) ?? '';
    check('no_resolution_label_rate_or_closure', !/resolv|\brate\b|clos/i.test(result) && result.includes('Order of records not known, not read1 case'), result);

    // ---- the evidence: the history with its last request marked, and the keyboard back on the incident ----
    const open = panel().getByRole('button', {name: 'Open R-3 with its last request marked', exact: true});
    await open.click();
    await page.getByRole('heading', {name: 'Case R-3'}).waitFor();
    const marked = await page.locator('.imported-inspector [data-contributing]').allTextContents();
    check('history_marks_the_last_request', marked.length === 1 && marked[0].includes('Asked customer') && marked[0].includes(first.cases.find(item => item.case_id === 'R-3').last_request.row_id), marked);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open R-3 with its last request marked');
    check('keyboard_back_on_the_incident', true);

    // ---- a changed definition asks for a new review ----
    await panel().getByLabel('Turn column').selectOption({label: 'No turn'});
    await panel().getByLabel(/starts a new matter after a gap/).fill('');
    check('changed_definition_needs_a_new_review', await findButton.isDisabled() && !(await panel().getByRole('checkbox', {name: /I have reviewed this definition/}).isChecked())
      && await panel().getByRole('table', {name: 'Cases whose last request has no later answer'}).count() === 0, null);
    await panel().getByRole('checkbox', {name: /I have reviewed this definition/}).check();
    await find('plain');

    // ---- saved with the investigation ----
    await page.getByRole('button', {name: 'Save', exact: true}).click();
    const form = page.getByRole('region', {name: 'Save this investigation'});
    await form.getByLabel('Name').fill(NAME);
    await form.getByRole('button', {name: 'Save', exact: true}).click();
    await page.locator('#saved-form').getByRole('status').getByText(`Saved as the new investigation “${NAME}”.`).waitFor();
    const saved = saves.at(-1);
    check('reviewed_definition_saved_bound_to_the_reading', same(saved.presentation_state?.requests, {preparation_id: saved.base_identity.preparation_id, ...expected.plain.definition, reviewed: true}), saved.presentation_state);
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks, base_identity: saved.base_identity, selection_identity: saved.selection_identity, parent_case_ids: saved.selection_recipe.parent_case_ids}));
  } else {
    check('browser_kept_no_definition', await page.evaluate(() => Object.keys(window.localStorage).filter(key => key.startsWith('wise-platform.requests')).length) === 0, null);
    await areas.getByRole('button', {name: 'Saved', exact: true}).click();
    await page.getByRole('button', {name: `Reopen ${NAME}`, exact: true}).click();
    await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, expected.incidents.length);
    await settled(0);
    await openRequests();
    check('definition_reopened_from_the_investigation', ((await panel().textContent()) ?? '').includes(`The definition saved with the investigation “${NAME}”.`)
      && await panel().getByRole('group', {name: 'Request activities'}).getByRole('checkbox', {name: 'Asked customer', exact: true}).isChecked()
      && await panel().getByRole('checkbox', {name: /I have reviewed this definition/}).isChecked(), null);
    await find('plain');
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks}));
  }
} finally {
  await browser.close();
}
