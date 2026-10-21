// The built browser through a comparison within a frozen parent (#14) of the invented tests/fixtures/frozen-parent
// file. In Investigations the eligibility step (begins with Opened) and the clause (contains Resolved) are taken; in
// Compare, "Kept against removed" freezes the parent after the first and splits it by the second. The parent, its
// eligibility-unknown incident, the role names, the absent-resolution wording, the Team context with its missing value,
// the fixed Region, both sides' histories and the focus, a nullable interval clause with its unknown in neither side,
// and the explicit way back to every incident are checked against expected.json.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 900}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [], comparisons = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  const path = new URL(response.url()).pathname;
  if (!response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (!answer) return;
  if (path === '/api/investigations/select-cases' && !answer.request_id.startsWith('preview-') && !answer.request_id.startsWith('parent-')) selections.push(answer);
  if (path === '/api/investigations/compare-groups') comparisons.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areas = page.getByRole('navigation', {name: 'Areas'});
const view = name => page.getByRole('group', {name: 'View'}).getByRole('button', {name, exact: true});
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
/** Waits for the next answered comparison after `before` of them, and returns it. */
async function next(before) {
  while (comparisons.length === before) await page.waitForTimeout(100);
  return comparisons.at(-1);
}
const res = expected.resolution;

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, expected.incidents);
  await settled(0);

  // The eligibility step, from the flow Start → Opened in the list of every path.
  await view('Paths').click();
  const list = page.getByRole('table', {name: 'Paths of the kept cases'});
  await list.locator('tbody tr').filter({has: page.locator('th', {hasText: /^Start$/})}).filter({has: page.locator('td', {hasText: /^Opened$/})}).locator('th button').click();
  await page.getByRole('button', {name: 'Keep cases that begin with it', exact: true}).click();
  await settled(1);
  const eligible = selections.at(-1);
  check('eligibility_step_as_the_oracle', same(eligible.kept.case_ids, expected.parent.case_ids) && same(eligible.removed.case_ids, expected.parent.outside)
    && same(eligible.unevaluable.case_ids, expected.parent.eligibility_unknown), eligible.kept);
  // The clause, from the activity Resolved on the map.
  await view('Map').click();
  await page.locator('.react-flow__node-activity', {hasText: 'Resolved'}).first().click();
  await page.getByRole('button', {name: 'Keep cases that contain it', exact: true}).click();
  await settled(2);

  // In Compare, the last step splits the parent frozen after the first.
  await areas.getByRole('button', {name: 'Compare', exact: true}).click();
  await page.getByRole('button', {name: 'Kept against removed', exact: true}).click();
  const parentNote = page.getByRole('note', {name: 'Parent'});
  await parentNote.waitFor();
  const parentText = (await parentNote.textContent()) ?? '';
  check('parent_frozen_and_eligibility_unknown_named', parentText.includes(`the parent P is frozen (parent 1): ${expected.parent.case_ids.length} cases kept by Keep cases that begin with “Opened”.`)
    && parentText.includes('1 case whose eligibility is unknown, as a step could not evaluate it, is outside it.'), parentText);
  const nameA = await page.getByLabel('Name of group A').inputValue();
  const nameB = await page.getByLabel('Name of group B').inputValue();
  check('roles_named_from_the_clause', nameA === res.target_name && nameB === res.reference_name, [nameA, nameB]);
  const firstCount = comparisons.length;
  await page.locator('button.compare-primary').click();
  const first = await next(firstCount);
  await page.locator('.compare-table').waitFor();
  check('parent_is_the_frozen_parent_not_the_whole_log', same(first.parent.case_ids, expected.parent.case_ids), first.parent.case_ids);
  check('sides_as_the_oracle', same(first.target.included.case_ids, res.target) && same(first.reference.included.case_ids, res.reference)
    && same(first.target.unevaluable.case_ids, res.unevaluable) && !first.reference.included.case_ids.includes('F06'), [first.target.included, first.reference.included]);
  const roles = (await page.locator('.compare-roles').textContent()) ?? '';
  check('roles_apart_from_included_and_excluded', roles.includes('A is the target and B the reference: A holds the cases of the parent the clause includes, B those it excludes'), roles);
  check('no_recorded_resolution_not_open', roles.includes('“No recorded “Resolved”” says only that the export holds no record of it: not that the case is open or unresolved.'), roles);
  const headers = await page.locator('.compare-table thead th').allTextContents();
  check('columns_named_by_role_and_name', headers.includes(`A: ${res.target_name}`) && headers.includes(`B: ${res.reference_name}`), headers);
  const team = Object.fromEntries(first.context_profile.categories.map(category => [category.value ?? 'not recorded', [category.parent.case_count, category.target.case_count, category.reference.case_count]]));
  check('team_context_with_its_missing_value', Object.entries(res.team).every(([value, counts]) => same(team[value], [counts.parent, counts.target, counts.reference])), team);
  check('missing_value_shown_as_not_recorded', await page.locator('.compare-table').getByText(/not recorded/).count() > 0, null);

  // Both sides' incidents open their histories; the comparison stays; the focus returns.
  await page.getByRole('group', {name: 'Inspect the cases of'}).getByRole('button', {name: 'Both', exact: true}).click();
  const sides = page.getByRole('list', {name: 'Cases of A and B'});
  const items = await sides.getByRole('listitem').allTextContents();
  check('both_sides_listed_with_their_roles', same(items.map(item => item.split(' Open')[0]), [...res.target.map(id => `${id} · A`), ...res.reference.map(id => `${id} · B`)].sort()), items);
  const absent = res.reference[0];
  await sides.getByRole('button', {name: `Open ${absent}`, exact: true}).click();
  const history = page.getByRole('region', {name: new RegExp(`^Case ${absent}, of B`)});
  await history.getByRole('table', {name: new RegExp(`^All \\d+ records of case ${absent}`)}).waitFor();
  check('side_history_whole_beside_the_comparison', await page.locator('.compare-table').count() === 1, null);
  await history.getByRole('button', {name: 'Return to the comparison', exact: true}).click();
  await page.waitForFunction(name => document.activeElement?.textContent === name, `Open ${absent}`);
  check('return_restores_the_focus', true);

  // Region is constant in the parent: fixed, said so.
  const regionCount = comparisons.length;
  await page.getByLabel('Opening value of').selectOption({label: 'Region'});
  const region = await next(regionCount);
  await page.getByText(/Region is fixed in the parent/).waitFor();
  check('fixed_field_labelled', region.context_profile.parent_fixed.status === 'fixed' && region.context_profile.parent_fixed.value === expected.region.fixed, region.context_profile.parent_fixed);

  // A nullable clause: its unknown is in neither side.
  await areas.getByRole('button', {name: 'Investigations', exact: true}).click();
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(1);
  await page.getByRole('button', {name: 'Filters and views'}).click();
  await page.getByRole('group', {name: 'Side panel'}).getByRole('button', {name: 'Interval', exact: true}).click();
  const panel = page.locator('section.interval-panel');
  await panel.getByLabel('Start activity').selectOption('Opened');
  await panel.getByLabel('Response activity').selectOption('Resolved');
  await panel.getByRole('button', {name: 'Measure the interval', exact: true}).click();
  await panel.getByLabel('Threshold in hours').fill(String(expected.long_interval.clause.hours));
  await panel.getByLabel(/^more than the threshold/).check();
  await panel.getByRole('button', {name: 'Preview this tail', exact: true}).click();
  await panel.getByRole('group', {name: 'Tail not yet applied'}).getByRole('button', {name: 'Apply', exact: true}).click();
  await settled(2);
  await areas.getByRole('button', {name: 'Compare', exact: true}).click();
  await page.getByRole('button', {name: 'Kept against removed', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Parent"]')?.textContent?.includes('(parent 2)'));
  const before = comparisons.length;
  await page.locator('button.compare-primary').click();
  const nullable = await next(before);
  await page.waitForFunction(() => document.querySelector('.compare-status')?.textContent?.startsWith('Comparison shown'));
  const interval = expected.long_interval;
  check('nullable_clause_unknowns_in_neither_side', same(nullable.parent.case_ids, expected.parent.case_ids) && same(nullable.target.included.case_ids, interval.target)
    && same(nullable.reference.included.case_ids, interval.reference) && same(nullable.target.unevaluable.case_ids, interval.unevaluable), [nullable.target, nullable.reference]);
  const unknownRow = await page.locator('.compare-table tbody tr', {hasText: 'Not evaluable for membership'}).textContent();
  check('unknown_row_shown', unknownRow.includes('1'), unknownRow);

  // Back to every incident, explicitly: no frozen parent is named, and the next comparison is of the whole population.
  await page.getByRole('note', {name: 'Parent'}).getByRole('button', {name: 'Use every case as the parent', exact: true}).click();
  check('rebase_explicit', await page.getByRole('note', {name: 'Parent'}).count() === 0 && (await page.locator('.compare-head').textContent()).includes('the parent is every case'), null);
  const beforeWhole = comparisons.length;
  await page.locator('button.compare-primary').click();
  const whole = await next(beforeWhole);
  check('whole_population_after_rebase', whole.parent.case_count === expected.incidents, whole.parent.case_count);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
