// The built browser through the groups by a stated rule (#64) of the invented tests/fixtures/rule-groups file: each of the
// six rules groups the incidents as the hand-written expected.json does; the rule is said, who is eligible, the incidents
// it cannot evaluate because their order is not fully known, the records without a value and the values too rare to form
// a group; a chosen group states its rule, its support, its distributions against the whole parent and its exemplars;
// and its incidents are kept as one step, undone exactly.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 768}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [], answers = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  const path = new URL(response.url()).pathname;
  if (!response.ok() || (path !== '/api/investigations/select-cases' && path !== '/api/investigations/rule-groups')) return;
  const answer = await response.json().catch(() => null);
  if (answer === null) return;
  if (path === '/api/investigations/rule-groups') answers.push(answer);
  else if (!answer.request_id.startsWith('preview-')) selections.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areas = page.getByRole('navigation', {name: 'Areas'});
const view = name => page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name, exact: true});
const panel = () => page.getByRole('region', {name: 'Groups of the kept incidents'});
const incidents = 6;
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
/** The groups listed, as [name, count] pairs, once the answer to the rule chosen has been drawn. */
async function listed() {
  await page.waitForFunction(() => document.querySelectorAll('.groups-list .groups-row').length > 0 && !document.querySelector('.groups-panel .working-text'));
  return panel().locator('.groups-row').evaluateAll(rows => rows.map(row => [row.querySelector('.groups-name').textContent, Number(row.querySelector('.groups-count').textContent.replace(/,/g, ''))]));
}
async function choose(label) {
  const before = answers.length;
  await panel().getByRole('combobox', {name: 'Grouped by'}).selectOption({label});
  await page.waitForFunction(() => !document.querySelector('.groups-panel .working-text'));
  while (answers.length === before) await page.waitForTimeout(50);
  await page.waitForTimeout(100);
  return answers.at(-1);
}
const nameOf = (kind, value) => kind === 'missing_activity' ? 'No activity label' : kind === 'missing_reference' ? 'Not recorded'
  : kind === 'exact_sequence' ? value.join(' → ') : kind === 'activity_presence' ? `${value ? 'With' : 'Without'} ${expected.parent.activity_presence.activity}`
  : kind === 'raw_record_count_band' ? (value[1] - value[0] === 1 ? (value[0] === 1 ? '1 record' : `${value[0]} records`) : `${value[0]}–${value[1] - 1} records`) : value;
const wanted = name => expected.parent[name].groups.map(([kind, value, ids]) => [nameOf(kind, value), ids.length]);

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, incidents);
  await settled(0);
  const parent = selections.at(-1);
  const asked = selections.length;
  await view('Incidents').click();
  await page.getByRole('button', {name: 'Groups', exact: true}).click();
  await panel().waitFor();

  // First activity: the rule said, who is eligible, and the incident of unknown order that it cannot evaluate.
  const first = await listed();
  check('first_activity_groups', same(first, wanted('first_raw_activity')), first);
  check('first_activity_rule_said', await panel().getByText(/^Each incident is in the group of the activity of its first record in the declared order\. An incident whose order is not fully known cannot be evaluated/).count() === 1, null);
  check('eligibility_said', await panel().getByText(`Eligible for the rule: ${incidents - 1} of ${incidents} kept incidents, and ${incidents - 1} of ${incidents} incidents in the parent.`, {exact: true}).count() === 1,
    await panel().locator('.groups-eligible').textContent());
  check('unknown_order_unevaluable_said', await panel().getByText('1 incident the rule cannot evaluate (parent 1): the order of their records is not fully known', {exact: true}).count() === 1, null);
  check('no_class_no_cause_said', await panel().getByText('A group is what its stated rule puts together: it is not a business class, and a difference between groups is not a cause.', {exact: true}).count() === 1, null);

  // The other rules, each as the oracle groups the parent.
  for (const [label, name] of [['Last activity', 'last_raw_activity'], ['Exact sequence of activities', 'exact_mapped_sequence'], ['Number of records', 'raw_record_count_bands'],
    [`With or without ${expected.parent.activity_presence.activity}`, 'activity_presence'], ['Same Ref', 'shared_reference']]) {
    const answer = await choose(label);
    const shown = (await listed()).filter(([, count]) => count > 0);
    check(`${name}_groups`, same(shown, wanted(name)) && same(answer.parent_coverage.unevaluable.case_ids, expected.parent[name].unevaluable), [shown, wanted(name)]);
    const unevaluable = await panel().getByText(/the rule cannot evaluate/).count();
    check(`${name}_unevaluable_said_only_when_ordered`, unevaluable === (expected.parent[name].unevaluable.length > 0 ? 1 : 0), unevaluable);
  }
  // The shared reference: the incident in no group, the records without a value, the values too rare.
  const coverage = expected.parent.shared_reference.coverage;
  check('reference_in_no_group_said', await panel().getByText(`1 incident in no group (parent 1): each value of Ref they have is recorded in too few incidents of the parent`, {exact: true}).count() === 1, null);
  check('reference_missing_values_said', await panel().getByText(`${coverage.population_missing_reference_record_count} record of the kept incidents without a value of Ref (parent ${coverage.parent_missing_reference_record_count}); ${coverage.parent_suppressed_nonmissing_value_count} of the ${coverage.parent_distinct_nonmissing_value_count} values in the parent form no group.`, {exact: true}).count() === 1,
    await panel().locator('.groups-limit').allTextContents());

  // A chosen group states its rule, its support, its distributions against the whole parent and its exemplars.
  await choose('First activity');
  await listed();
  await panel().locator('.groups-row', {hasText: 'Opened'}).click();
  const detail = panel().locator('.groups-detail');
  await detail.waitFor();
  check('group_rule_said', await detail.getByText('Incidents whose first record in the declared order has the activity “Opened”.', {exact: true}).count() === 1, null);
  const figures = await detail.locator('.groups-figures > div').allTextContents();
  check('group_support_in_parent_and_kept', same(figures, ['In the parent4 of 5 eligible · 80%', 'Kept4 of 5 eligible · 80%']), figures);
  check('group_distributions_against_the_whole_parent', await detail.getByRole('group', {name: "Recorded spans of the group's kept incidents against the whole parent"}).count() === 1
    && await detail.getByRole('group', {name: "Longest gaps of the group's kept incidents against the whole parent"}).count() === 1, null);
  check('group_exemplars', await detail.getByRole('button', {name: 'Shortest: G-5, 0 min'}).count() === 1 && await detail.getByRole('button', {name: 'Longest: G-4, 24 h'}).count() === 1,
    await detail.locator('.groups-exemplars').textContent());

  // Choosing takes no step; keeping takes one with the group's incidents, undone exactly.
  check('choosing_takes_no_step', selections.length === asked && await page.getByRole('list', {name: 'Steps of the selection'}).count() === 0, selections.length);
  await page.getByRole('button', {name: 'Keep these incidents', exact: true}).click();
  await settled(1);
  const keptGroup = expected.parent.first_raw_activity.groups[0][2];
  check('keep_applies_the_group_incidents_inside_the_parent', same(selections.at(-1).kept.case_ids, keptGroup) && selections.at(-1).parent.case_count === parent.parent.case_count, selections.at(-1).kept);
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  check('keep_undone_exactly', same(selections.at(-1).identity, parent.identity), null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
