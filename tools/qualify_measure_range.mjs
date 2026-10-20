// The built browser through the range control (#89) over the invented tests/fixtures/span-gap file: the control says that
// both bounds are included and which incidents have the measure; each range of the hand-written ranges.json is previewed
// with its not-evaluable count, taken as one step that keeps, removes and leaves unevaluable the oracle's incidents, shown
// in the incident table, and undone exactly.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
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
const control = () => page.locator('details', {has: page.getByText('A range of records, span or longest gap', {exact: true})});
const MEASURES = {raw_record_count: 'Number of records', observed_span_hours: 'Recorded span, first to last recorded time', maximum_adjacent_raw_gap_hours: 'Longest gap between two records'};
const UNIT = {raw_record_count: 'records', observed_span_hours: 'hours', maximum_adjacent_raw_gap_hours: 'hours'};
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
async function openControl() {
  if (await control().count() === 0 || !(await control().isVisible())) {
    await page.getByRole('button', {name: 'Filters and views'}).click();
    await page.getByRole('group', {name: 'Side panel'}).getByRole('button', {name: 'Filters', exact: true}).click();
  }
  if (await control().getAttribute('open') === null) await control().locator('summary').click();
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
  await openControl();

  // The control says that both bounds are included and which incidents have each measure.
  check('equality_at_a_bound_said', await control().getByText(/^Both bounds are included: an incident exactly at a bound is in the range\./).count() === 1, null);
  for (const [measure, said] of [['raw_record_count', 'Every incident has a number of records; records without an activity label count.'],
    ['observed_span_hours', 'An incident whose order is not known has no recorded span: it is not evaluable and is counted apart, neither kept nor removed.'],
    ['maximum_adjacent_raw_gap_hours', 'An incident whose order is not known, or with one record, has no longest gap: it is not evaluable and is counted apart, neither kept nor removed.']]) {
    await control().getByLabel('Measure of the range').selectOption(measure);
    check(`${measure}_evaluability_said`, (await control().locator('p.muted').textContent()).includes(said), await control().locator('p.muted').textContent());
  }

  // Every range of the oracle: previewed with its counts, taken as one step, shown in the table, undone exactly.
  for (const range of expected.ranges) {
    await openControl();
    await control().getByLabel('Measure of the range').selectOption(range.measure);
    await control().getByLabel(`From, included (${UNIT[range.measure]})`).fill(String(range.minimum));
    await control().getByLabel(`To, included (${UNIT[range.measure]}; empty for no upper bound)`).fill(range.maximum === null ? '' : String(range.maximum));
    const asked = selections.length;
    await control().getByRole('button', {name: range.negate ? 'Remove this range' : 'Keep this range', exact: true}).click();
    const pending = page.getByRole('group', {name: 'Filter not yet taken'});
    const preview = pending.locator('.step-preview');
    await page.waitForFunction(() => /^Preview: would keep/.test(document.querySelector('[aria-label="Filter not yet taken"] .step-preview')?.textContent ?? ''));
    const previewed = await preview.textContent();
    const kept = range.kept.length, removed = range.removed.length, unevaluable = range.unevaluable.length;
    check(`${range.name}_previewed_with_not_evaluable`, previewed.startsWith(`Preview: would keep ${kept} incident${kept === 1 ? '' : 's'} of ${incidents} incidents; ${removed} removed, ${unevaluable} not evaluable.`) && selections.length === asked, previewed);
    await pending.getByRole('button', {name: 'Take this step', exact: true}).click();
    await settled(1);
    const taken = selections.at(-1);
    check(`${range.name}_one_step_as_the_oracle`, same(taken.kept.case_ids, range.kept) && same(taken.removed.case_ids, range.removed) && same(taken.unevaluable.case_ids, range.unevaluable)
      && taken.predicate_results.length === 1 && taken.predicate_results[0].predicate.kind === 'measure_between', [taken.kept.case_ids, taken.unevaluable.case_ids]);
    const chip = page.getByRole('list', {name: 'Steps of the selection'}).locator('li').first();
    const chipText = await chip.textContent();
    check(`${range.name}_not_evaluable_counted_on_the_step`, chipText.includes(`Not evaluable${unevaluable} incident${unevaluable === 1 ? '' : 's'}`), chipText);
    await page.waitForFunction(n => document.querySelectorAll('.incident-table table tbody tr button.row-open').length === n, kept);
    const listed = (await page.locator('.incident-table table tbody tr button.row-open').allTextContents()).sort();
    check(`${range.name}_table_shows_only_the_kept`, same(listed, range.kept), listed);
    await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
    await settled(0);
    check(`${range.name}_undone_exactly`, same(selections.at(-1).identity, parent.identity), null);
  }
  // A range that is not one is refused in the control, and nothing is applied.
  await openControl();
  await control().getByLabel('Measure of the range').selectOption('maximum_adjacent_raw_gap_hours');
  await control().getByLabel('From, included (hours)').fill('5');
  await control().getByLabel('To, included (hours; empty for no upper bound)').fill('2');
  const before = selections.length;
  await control().getByRole('button', {name: 'Keep this range', exact: true}).click();
  check('reversed_range_refused', (await page.getByRole('alert').first().textContent()) === 'The upper bound is below the lower bound. Nothing was applied.' && selections.length === before, null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
