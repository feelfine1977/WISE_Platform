// The built browser through the trail of steps (#93) over the invented tests/fixtures/span-gap file: three steps taken
// from the Filters stand as short chips, the earliest first, each with the incidents kept after it as the hand-written
// trail.json says; a chip's details open on demand with its full wording and counts; choosing a chip shows the state
// after it with the later steps kept, forward and back along the trail and back to the parent; a new step drops them.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {addStep} from './add_step.mjs';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const trail = expected.trail;
const incidents = expected.orders['observed_span_hours descending'].length;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 768}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  if (new URL(response.url()).pathname !== '/api/investigations/select-cases' || !response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (answer && !answer.request_id.startsWith('preview-')) selections.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areas = page.getByRole('navigation', {name: 'Areas'});
const view = name => page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name, exact: true});
const applied = () => page.getByRole('list', {name: 'Steps of the selection'});
const later = () => page.getByRole('list', {name: 'Later steps, not applied now'});
const summaries = list => list.locator('summary').allTextContents();
const chipLine = index => `${index + 1}. ${trail.short[index]}${trail.kept_after[index].case_ids.length} kept`;
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
// Every step by a value starts from "+ Add step" (#94) and is applied at once.
async function filters() {}
const open = kind => addStep(page, kind);
async function take(steps) {
  await settled(steps);
}
async function chooseChip(list, index) {
  const chip = list.getByRole('listitem').nth(index);
  if (await chip.locator('details').getAttribute('open') === null) await chip.locator('summary').click();
  await chip.getByRole('button', {name: 'Show the selection after this step', exact: true}).click();
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, incidents);
  await settled(0);
  const parent = selections.at(-1);
  await view('Incidents').click();

  // Three steps from the Filters: a range of records, a span, and a value of the chosen context column Agent.
  await filters();
  let control = await open('A range of records, span or longest gap');
  await control.getByLabel('Measure of the range').selectOption('raw_record_count');
  await control.getByLabel('From, included (records)').fill('2');
  await control.getByLabel('To, included (records; empty for no upper bound)').fill('3');
  await control.getByRole('button', {name: 'Keep this range', exact: true}).click();
  await take(1);
  control = await open('Recorded time');
  await control.getByLabel('Measure').selectOption('observed_span_at_least');
  await control.getByLabel('At least this many hours').fill('2');
  await control.getByRole('button', {name: 'Keep by recorded time', exact: true}).click();
  await take(2);
  control = await open('Context values');
  await control.getByLabel('Context column').selectOption({label: 'Agent'});
  await control.getByLabel('Where to look').selectOption('any');
  await control.getByLabel('Exact context values').fill('Cy');
  await control.getByRole('button', {name: 'Keep by context', exact: true}).click();
  await take(3);
  const full = selections.at(-1);
  check('three_steps_as_the_oracle', same(full.predicate_results.map(result => result.predicate), trail.steps) && same(full.kept.case_ids, trail.kept_after[2].case_ids), full.kept.case_ids);
  check('kept_after_each_step_supplied', same(full.predicate_results.map(result => result.kept_after_step), trail.kept_after.map(step => ({case_count: step.case_ids.length, record_count: step.record_count}))),
    full.predicate_results.map(result => result.kept_after_step));

  // A trail of short chips, the earliest first, each with the incidents kept after it; the last is the state shown.
  const chips = await summaries(applied());
  check('trail_of_short_chips_with_kept_after', same(chips, [0, 1, 2].map(chipLine)), chips);
  check('last_chip_is_the_state_shown', await applied().getByRole('listitem').nth(2).getAttribute('aria-current') === 'step', null);
  // The details of a chip open on demand.
  const first = applied().getByRole('listitem').first();
  check('details_closed_until_asked', await first.locator('details').getAttribute('open') === null && !(await first.locator('.chip-counts').isVisible()), null);
  await first.locator('summary').click();
  const after = trail.kept_after[0];
  check('details_open_on_demand', await first.locator('.chip-counts').isVisible()
    && (await first.locator('.chip-wording').textContent()) === 'Keep incidents with 2 to 3 records, both included'
    && (await first.locator('.chip-after').textContent()) === `After this step: ${after.case_ids.length} incidents · ${after.record_count} records kept`, await first.locator('.chip-after').textContent());

  // The state after the first step: the later steps stay in the trail, not applied, with their counts.
  await chooseChip(applied(), 0);
  await settled(1);
  check('state_after_the_first_step', same(selections.at(-1).kept.case_ids, trail.kept_after[0].case_ids), selections.at(-1).kept.case_ids);
  await page.waitForFunction(n => document.querySelectorAll('.incident-table table tbody tr button.row-open').length === n, trail.kept_after[0].case_ids.length);
  check('table_shows_the_state_after_it', true);
  // On request, a picture of the trail with later steps, for a reader to look at; it holds only the invented file.
  if (process.env.WISE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.WISE_SCREENSHOT_DIR}/issue93-step-trail.png`});
  check('later_steps_kept_with_their_counts', same(await summaries(later()), [1, 2].map(chipLine)), await summaries(later()));
  // Forward along the same trail to its last step.
  await chooseChip(later(), 1);
  await settled(3);
  check('forward_to_the_last_step', same(selections.at(-1).identity, full.identity) && await later().count() === 0, null);
  // Back to the parent: every step is a later step; a new step drops them.
  await page.getByRole('button', {name: `Every incident of the parent · ${incidents}`, exact: true}).click();
  await settled(0);
  check('back_to_the_parent', same(selections.at(-1).identity, parent.identity) && (await summaries(later())).length === 3, null);
  control = await open('Recorded time');
  await control.getByLabel('At least this many hours').fill('2');
  await control.getByRole('button', {name: 'Keep by recorded time', exact: true}).click();
  await take(1);
  check('new_step_drops_the_later_steps', await later().count() === 0 && (await summaries(applied())).length === 1, await summaries(applied()));
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
