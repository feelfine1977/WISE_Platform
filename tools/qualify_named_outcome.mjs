// The built browser through a separately named outcome (#16) on the fictional S0 file. The parent (service S) and the
// clause (contains Resolved) are taken in Investigations and the assignment groups compared; the outcome "no recorded
// Resolved" is named apart from the groups: K = P, the parent rate 5/12, App 2/4 and lift 1.20 beside the profile ratio
// 1.40, every value's rate as the oracle; App's witnesses open down to a complete history and the focus returns to the
// same list; exchanging the roles leaves the outcome as it is; an activity no record carries names no outcome.
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
  await next(before);
  await page.getByRole('button', {name: 'Exchange A and B', exact: true}).first().click();
  before = comparisons.length;
  await page.locator('button.compare-primary').click();
  await next(before);
  await page.getByRole('button', {name: 'Show the ratio of shares', exact: true}).click();
  const profileApp = (await page.locator('.compare-table').first().locator('tbody tr', {hasText: 'First recorded with assignment_group App'}).textContent()) ?? '';

  // The outcome, named apart from the groups.
  const outcome = page.getByRole('region', {name: 'Outcome by opening value'});
  await outcome.getByLabel('Activity of the outcome').selectOption('Resolved');
  await outcome.getByLabel(/^its absence/).check();
  await outcome.getByRole('button', {name: 'Show the outcome by value', exact: true}).click();
  const table = outcome.getByRole('table', {name: 'No recorded “Resolved” by the first recorded assignment_group'});
  await table.waitFor();
  const said = (await outcome.textContent()) ?? '';
  check('outcome_named_with_its_known_subset', said.includes('Outcome O: No recorded “Resolved” at the snapshot cutoff') && said.includes('Known for 12 cases of the 12 cases of the parent (K = P)')
    && said.includes(`In the parent, O holds for 5 of 12 (41.7%).`), said);
  check('absence_not_a_business_verdict', said.includes('it is not a verdict that the case is unresolved or open'), null);
  const valueRows = await table.locator('tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(cell => cell.textContent)));
  const app = valueRows.find(cells => cells[0] === 'App');
  check('app_rate_two_fourths_lift_one_point_two_apart_from_ratio_one_point_four', app[3] === '2 of 4 (50.0%)' && app[4] === '1.20' && profileApp.includes('1.40'), [app, profileApp]);
  // Every value's rate of O and lift, from the oracle: O is no recorded resolution (the B side of S0), K the A and B incidents.
  const percent = new Intl.NumberFormat('en', {style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1});
  const fraction = text => text.includes('/') ? Number(text.split('/')[0]) / Number(text.split('/')[1]) : Number(text);
  const rates = {}, lifts = {};
  for (const [key, profile] of Object.entries(S0.opening_profile)) {
    const value = key.startsWith('missing:') ? 'not recorded' : key.split(':')[1];
    const known = profile.A_ids.length + profile.B_ids.length;
    rates[value] = `${profile.B_ids.length} of ${known} (${percent.format(profile.B_ids.length / known)})`;
    lifts[value] = fraction(profile.outcome_lift).toFixed(2);
  }
  check('every_value_rate_and_lift_as_the_oracle', Object.entries(rates).every(([value, rate]) => valueRows.some(cells => cells[0] === value && cells[3] === rate && cells[4] === lifts[value])), valueRows);
  check('lift_said_apart_from_the_share_ratio', said.includes('It is not the ratio of shares above'), null);

  // App's witnesses, down to a complete history and back to the same list.
  const asked = selections.length;
  await table.getByRole('button', {name: 'Witnesses with O for App', exact: true}).click();
  const witnesses = outcome.getByRole('list', {name: 'Witnesses for App'});
  const ids = (await witnesses.getByRole('listitem').allTextContents()).map(item => item.split(' ')[0]);
  const expectedIds = S0.opening_profile['value:App'].B_ids;
  check('witnesses_exactly_the_value_incidents_with_o', JSON.stringify(ids) === JSON.stringify(expectedIds), ids);
  await witnesses.getByRole('button', {name: `Open ${expectedIds[0]}`, exact: true}).focus();
  await page.keyboard.press('Enter');
  await outcome.getByRole('region', {name: new RegExp(`^Case ${expectedIds[0]}, of the parent`)}).getByRole('table').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(name => document.activeElement?.textContent === name, `Open ${expectedIds[0]}`);
  check('return_to_the_same_parent_value_and_outcome', selections.length === asked && await table.count() === 1 && await outcome.getByRole('list', {name: 'Witnesses for App'}).count() === 1, null);

  // Exchanging the roles leaves the outcome as it is.
  const outcomeBefore = await table.locator('tbody').textContent();
  await page.getByRole('button', {name: 'Exchange A and B', exact: true}).first().click();
  before = comparisons.length;
  await page.locator('button.compare-primary').click();
  await next(before);
  check('outcome_unchanged_by_the_roles', (await table.locator('tbody').textContent()) === outcomeBefore, null);

  // An activity no record carries names no outcome: unknown, not favourable.
  await outcome.getByLabel('Activity of the outcome').selectOption('Opened');
  await outcome.getByLabel(/^its presence/).check();
  await outcome.getByRole('button', {name: 'Show the outcome by value', exact: true}).click();
  await outcome.getByText(/O holds for 12 of 12/).waitFor();
  check('presence_counted_the_other_way', true);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
