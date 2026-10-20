// The built browser through the grouping operation (#51) over the invented tests/fixtures/grouping file: whole incidents
// grouped by Desk read at the first record, at the latest recorded value and on any record, as the hand-written
// expected.json groups them, with the incident of unknown order, the incident in no group and the overlap said; a group
// listed in the table changes nothing; made a side of Compare it is compared in that direction and the direction is
// exchanged on request; kept as a step it keeps exactly its incidents, and Undo restores the selection; a complete
// history opens from the group and returns.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [], comparisons = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  const path = new URL(response.url()).pathname;
  if (!response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (!answer) return;
  if (path === '/api/investigations/select-cases' && !answer.request_id.startsWith('preview-')) selections.push(answer);
  if (path === '/api/investigations/compare-groups') comparisons.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areas = page.getByRole('navigation', {name: 'Areas'});
const panel = () => page.getByRole('region', {name: 'Groups of the kept incidents'});
const table = () => page.getByRole('table', {name: 'Kept incidents'});

async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
/** The groups listed, as names with their kept incidents' count. */
const listed = () => panel().locator('.groups-list li').evaluateAll(items => items.map(item => item.textContent));
async function grouped(label) {
  await panel().getByLabel('Grouped by').selectOption({label});
  await page.waitForFunction(() => !document.querySelector('.groups-panel .working-text'));
}
async function choose(group) {
  await panel().getByRole('button', {name: new RegExp(`^${group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)}).first().click();
  await page.locator('.view-note').waitFor();
}
const rows = () => table().locator('tbody tr button.row-open').allTextContents();

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, 7);
  await settled(0);
  const parent = selections.at(-1);
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Incidents', exact: true}).click();
  await page.getByRole('button', {name: 'Groups', exact: true}).click();
  await panel().waitFor();
  check('operation_named_with_its_distinct_actions', ((await panel().locator('.groups-actions-said').textContent()) ?? '').includes('Choosing a group lists its incidents in the table and changes nothing; Keep or Remove takes a step with exactly its incidents; Compare as A or B makes it a side of a comparison'), null);

  // ---- three explicit readings of the context column ----
  for (const [label, policy] of [['Desk at the first record', 'first_record'], ['Desk, latest recorded value', 'latest_record'], ['Same Desk, on any record', 'any_record']]) {
    await grouped(label);
    const said = (await panel().textContent()) ?? '';
    const wanted = expected.groups[policy];
    const names = wanted.groups.map(([value]) => value ?? 'Not recorded');
    check(`${policy}_groups_as_the_oracle`, names.every(name => said.includes(name)) && (await listed()).length === wanted.groups.length, {listed: await listed(), names});
    check(`${policy}_reading_explicit`, said.includes(policy === 'any_record' ? 'so an incident with several values is in several groups' : 'so it is in exactly one group')
      && (policy === 'any_record' || said.includes('a recorded “Unknown” is a value')), said.slice(0, 600));
    check(`${policy}_unplaced_said`, (wanted.unevaluable.length === 0 || said.includes('the rule cannot evaluate')) && (wanted.in_no_group.length === 0 || said.includes('in no group')), said.slice(0, 900));
  }

  // ---- a group listed changes nothing; made side A, then B, compared and exchanged ----
  await grouped('Desk at the first record');
  const before = selections.length;
  await choose('Unknown');
  check('listing_a_group_changes_nothing', same(await rows(), expected.compare.target) && selections.length === before, await rows());
  await page.getByRole('button', {name: 'Compare as A', exact: true}).click();
  await page.getByText(/“Unknown” is side A in Compare, as its 2 incidents; the selection is unchanged\./).waitFor();
  await page.getByRole('button', {name: 'Show every incident', exact: true}).click();
  await choose('North');
  await page.getByRole('button', {name: 'Compare as B', exact: true}).click();
  await page.getByRole('button', {name: 'Show the comparison', exact: true}).click();
  await page.locator('main').getByRole('button', {name: 'Compare', exact: true}).click();
  for (let wait = 0; wait < 600 && comparisons.length === 0; wait += 1) await page.waitForTimeout(100);
  const first = comparisons.at(-1);
  check('group_sides_compared_in_their_direction', same(first.target.included.case_ids, ['G-5', 'G-7']) && same(first.reference.included.case_ids, ['G-1', 'G-2'])
    && selections.length === before, [first.target.included.case_ids, first.reference.included.case_ids]);
  await page.getByRole('button', {name: 'Exchange A and B', exact: true}).first().click();
  await page.locator('main').getByRole('button', {name: 'Compare', exact: true}).click();
  for (let wait = 0; wait < 600 && comparisons.length < 2; wait += 1) await page.waitForTimeout(100);
  const exchanged = comparisons.at(-1);
  check('direction_exchanged_on_request', same(exchanged.target.included.case_ids, ['G-1', 'G-2']) && same(exchanged.reference.included.case_ids, ['G-5', 'G-7']), null);

  // ---- kept as a step, a history read, and Undo ----
  await areas.getByRole('button', {name: 'Investigations', exact: true}).click();
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Incidents', exact: true}).click();
  if (!(await panel().count())) await page.getByRole('button', {name: 'Groups', exact: true}).click();
  await grouped('Desk at the first record');
  await choose('Unknown');
  await page.getByRole('button', {name: 'G-7', exact: true}).click();
  await page.getByRole('heading', {name: 'Incident G-7'}).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('ol.history > li').length > 0);
  check('complete_history_from_a_group', await page.locator('ol.history > li').count() === 3, await page.locator('ol.history > li').count());
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Keep these incidents', exact: true}).click();
  await settled(1);
  check('keep_takes_exactly_the_groups_incidents', same(selections.at(-1).kept.case_ids, expected.compare.target) && same(selections.at(-1).parent.case_ids, parent.kept.case_ids), selections.at(-1).kept.case_ids);
  await page.getByRole('group', {name: 'Steps', exact: true}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  check('undo_restores_the_selection', same(selections.at(-1).identity, parent.identity), null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
