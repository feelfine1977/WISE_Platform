// The built browser through the context concentration (#15) of the fictional S0 file. In Investigations the parent
// (first recorded at service S, from the Context chart) and the clause (contains Resolved, from the map) are taken; in
// Compare the assignment groups are compared. Paired counts come first; the ratio is shown on request, named
// A's share ÷ B's share with its direction; after exchanging the roles App is 2/5 against 2/7 = 1.40; Network is an
// exact zero and Email has no reference support, and both turn over with the roles. A tiny value's incidents are
// inspected by keyboard down to a complete history. No significance, risk or causal wording appears.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const S0 = config.expected.S0;
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
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
async function next(before) {
  while (comparisons.length === before) await page.waitForTimeout(100);
  await page.waitForFunction(() => document.querySelector('.compare-status')?.textContent?.startsWith('Comparison shown'));
  return comparisons.at(-1);
}
const rows = () => page.locator('.compare-table tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(cell => cell.textContent)));
const rowOf = (all, value) => all.find(cells => cells[0].startsWith(`First recorded with assignment_group ${value}`));

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, S0.base_cases);
  await settled(0);

  // The parent: the incidents first recorded at service S, from the Context chart.
  await page.getByRole('button', {name: 'Filters and views'}).click();
  await page.getByRole('group', {name: 'Side panel'}).getByRole('button', {name: 'Context', exact: true}).click();
  const context = page.getByRole('region', {name: 'At the first recorded observation'});
  await context.getByRole('list', {name: 'Opening values of service, most frequent first'}).getByRole('checkbox', {name: `Choose ${S0.fixed_parent_service}`, exact: true}).check();
  await context.getByRole('button', {name: 'Preview keeping cases first recorded with these values', exact: true}).click();
  await context.getByRole('group', {name: 'Values of service not yet applied'}).getByRole('button', {name: 'Apply', exact: true}).click();
  await settled(1);
  check('parent_as_the_oracle', same(selections.at(-1).kept.case_ids, S0.parent_ids), selections.at(-1).kept.case_ids);
  // The clause: contains Resolved, from the map.
  await page.getByRole('group', {name: 'View'}).getByRole('button', {name: 'Map', exact: true}).click();
  await page.locator('.react-flow__node-activity', {hasText: 'Resolved'}).first().click();
  await page.getByRole('button', {name: 'Keep cases that contain it', exact: true}).click();
  await settled(2);

  await areas.getByRole('button', {name: 'Compare', exact: true}).click();
  await page.getByRole('button', {name: 'Kept against removed', exact: true}).click();
  await page.getByRole('note', {name: 'Parent'}).waitFor();
  await page.getByLabel('Opening value of').selectOption({label: 'assignment_group'});
  let before = comparisons.length;
  await page.locator('button.compare-primary').click();
  const first = await next(before);
  check('sides_as_the_oracle', same(first.target.included.case_ids, S0.A_ids) && same(first.reference.included.case_ids, S0.B_ids), [first.target.included, first.reference.included]);
  const head = await page.locator('.compare-table thead th').allTextContents();
  check('paired_counts_first_no_ratio_by_default', !head.some(cell => cell.startsWith('Ratio')) && rowOf(await rows(), 'App')?.[3] === '−11.4 pp', [head, rowOf(await rows(), 'App')]);

  // The ratio on request, named with its direction; the roles exchanged turn it over.
  await page.getByRole('button', {name: 'Show the ratio of shares', exact: true}).click();
  const ratioNote = (await page.getByText(/^The ratio divides the share of a value in A/).textContent()) ?? '';
  check('ratio_named_with_direction', ratioNote.includes('above 1 the value is more frequent in A, below 1 in B') && ratioNote.includes('not a risk, a lift or a priority'), ratioNote);
  let all = await rows();
  check('ratio_of_the_resolved_target', rowOf(all, 'App')[4] === '0.71' && rowOf(all, 'Network')[4] === 'no reference support: none in No recorded “Resolved”'
    && rowOf(all, 'Email')[4] === '0.00: none in Recorded “Resolved” in this snapshot', [rowOf(all, 'App'), rowOf(all, 'Network'), rowOf(all, 'Email')]);
  await page.getByRole('button', {name: 'Exchange A and B', exact: true}).first().click();
  before = comparisons.length;
  await page.locator('button.compare-primary').click();
  const reversed = await next(before);
  check('exchange_keeps_the_memberships', same(reversed.target.included.case_ids, S0.B_ids) && same(reversed.reference.included.case_ids, S0.A_ids), null);
  if (!(await page.getByRole('button', {name: 'Hide the ratio of shares', exact: true}).count())) await page.getByRole('button', {name: 'Show the ratio of shares', exact: true}).click();
  all = await rows();
  const app = rowOf(all, 'App');
  check('app_two_fifths_against_two_sevenths_ratio_one_point_four', app[1] === '2 of 5 (40.0%)' && app[2] === '2 of 7 (28.6%)' && app[3] === '+11.4 pp' && app[4] === '1.40', app);
  check('edge_states_turn_over', rowOf(all, 'Network')[4] === '0.00: none in No recorded “Resolved” in this snapshot'
    && rowOf(all, 'Email')[4] === 'no reference support: none in Recorded “Resolved”', [rowOf(all, 'Network'), rowOf(all, 'Email')]);
  check('tiny_value_shows_its_support', rowOf(all, 'Email')[1] === '1 of 5 (20.0%)' && rowOf(all, 'Email')[2] === '0 of 7 (0.0%)', rowOf(all, 'Email'));

  // A value's incidents, by keyboard, down to a complete history; no step is taken.
  const asked = selections.length;
  const inspect = page.getByRole('button', {name: 'Inspect the cases first recorded with assignment_group App', exact: true});
  await inspect.focus();
  await page.keyboard.press('Enter');
  await page.getByText(/^Listed: the cases first recorded with assignment_group App, 2 of A and 2 of B\./).waitFor();
  const listed = await page.getByRole('list', {name: 'Cases of A and B'}).getByRole('listitem').allTextContents();
  const app_ids = [...S0.opening_profile['value:App'].B_ids.map(id => `${id} · A`), ...S0.opening_profile['value:App'].A_ids.map(id => `${id} · B`)].sort();
  check('value_incidents_listed_exactly', same(listed.map(item => item.split(' Open')[0]).sort(), app_ids), listed);
  const target = S0.opening_profile['value:App'].B_ids[0];
  await page.getByRole('button', {name: `Open ${target}`, exact: true}).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('region', {name: new RegExp(`^Case ${target}, of A`)}).getByRole('table').waitFor();
  check('inspection_reaches_the_history_without_a_step', selections.length === asked, null);
  await page.keyboard.press('Escape');
  await page.waitForFunction(name => document.activeElement?.textContent === name, `Open ${target}`);

  const text = (await page.locator('main').textContent()) ?? '';
  check('first_record_shares_add_up_ever_values_not_offered', text.includes('so the shares of a side add up. Values ever recorded later would overlap and not add up; they are not offered here.'), null);
  check('inversion_separate_from_exchange', await page.getByRole('button', {name: 'Exchange A and B'}).count() > 0, null);
  check('no_significance_or_causal_wording', !/significan(t|ce) \(|\bp\s*[<=]|\*\*|driver|blame|risk lift|caused by|because/i.test(text.replace('not tests of significance', '').replace('not a risk, a lift or a priority', '')), null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
