// The built browser through the list of every path (#55) of the invented tests/fixtures/variants file: each pair of
// activities and each flow carries the incidents, passages and median lag of the hand-written paths.json, and the
// incidents of unknown order are named. At the lowest detail a path the map leaves out is drawn on the map on request,
// selected, without a step; through it whole incidents are kept and removed, each undone exactly. A selection without a
// labelled record lists no path and says so.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const variants = config.expected;
const expected = variants.paths_oracle;
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
const view = name => page.getByRole('group', {name: 'View'}).getByRole('button', {name, exact: true});
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
const list = () => page.getByRole('table', {name: 'Paths of the kept incidents'});
const rows = () => list().locator('tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(cell => cell.textContent)));
const row = (from, to) => list().locator('tbody tr').filter({has: page.locator('th', {hasText: new RegExp(`^${from}$`)})}).filter({has: page.locator('td', {hasText: new RegExp(`^${to}$`)})}).first();
const lag = hours => new Intl.NumberFormat('en', {minimumFractionDigits: 1, maximumFractionDigits: 1}).format(hours);
const target = expected.paths.find(path => path.from === 'Resolved' && path.to === 'Assigned');

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, variants.incidents);
  await settled(0);
  const parent = selections.at(-1);
  const asked = selections.length;

  // Every pair and every flow with the supplied numbers of the oracle.
  await view('Paths').click();
  await list().waitFor();
  const listed = await rows();
  const pairs = listed.filter(cells => cells[0] !== 'Start' && cells[1] !== 'End').map(cells => cells.slice(0, 5)).sort();
  const wanted = expected.paths.map(path => [path.from, path.to, String(path.incidents), String(path.passages), lag(path.median_lag_hours)]).sort();
  check('every_pair_with_its_supplied_numbers', same(pairs, wanted), [pairs, wanted]);
  const flows = listed.filter(cells => cells[0] === 'Start' || cells[1] === 'End').map(cells => [cells[0], cells[1], cells[2]]).sort();
  const wantedFlows = [...Object.entries(expected.starts).map(([activity, n]) => ['Start', activity, String(n)]), ...Object.entries(expected.ends).map(([activity, n]) => [activity, 'End', String(n)])].sort();
  check('every_flow_with_its_incidents', same(flows, wantedFlows), [flows, wantedFlows]);
  check('unknown_order_named', await page.getByText(`${expected.not_evaluable_for_paths} incident not evaluable for paths`).count() > 0, null);

  // At the lowest detail a path the map leaves out is drawn on request, without a step.
  const slider = page.getByRole('form', {name: 'Detail'}).getByRole('slider', {name: 'Paths'});
  await slider.focus();
  await page.keyboard.press('Home');
  await page.waitForFunction(() => [...document.querySelectorAll('table[aria-label="Paths of the kept incidents"] tbody tr')].some(tr => tr.lastElementChild?.textContent === 'Not drawn'));
  check('hidden_path_said_not_drawn', (await row(target.from, target.to).locator('td').last().textContent()) === 'Not drawn', await rows());
  await row(target.from, target.to).locator('th button').click();
  await page.getByRole('button', {name: 'Draw on the map', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="View"] button[aria-pressed="true"]')?.textContent === 'Map');
  check('draw_shows_the_map_with_the_path_drawn_on_request', await page.getByText('1 path drawn on request beyond the detail.').count() === 1 && selections.length === asked, selections.length);
  await view('Paths').click();
  const drawnRow = row(target.from, target.to);
  check('drawn_path_selected_without_a_step', (await drawnRow.locator('td').last().textContent()) === 'Drawn' && await drawnRow.locator('th button').getAttribute('aria-pressed') === 'true'
    && selections.length === asked && await page.getByRole('list', {name: 'Steps of the selection'}).count() === 0, null);

  // Keep and remove the whole incidents through the path; each is undone exactly.
  for (const [label, name] of [[`Keep incidents where “${target.to}” directly follows “${target.from}”`, 'keep_resolved_to_assigned'], ['Keep incidents where it never does', 'never_resolved_to_assigned']]) {
    if (await row(target.from, target.to).locator('th button').getAttribute('aria-pressed') !== 'true') await row(target.from, target.to).locator('th button').click();
    await page.getByRole('button', {name: label, exact: true}).click();
    await settled(1);
    const applied = selections.at(-1);
    check(`${name}_whole_incidents`, same(applied.kept.case_ids, expected[name].kept) && same(applied.unevaluable.case_ids, expected[name].unevaluable), applied.kept);
    await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
    await settled(0);
    check(`${name}_undone_exactly`, same(selections.at(-1).identity, parent.identity), null);
    await list().waitFor();
  }

  // A selection without a labelled record: no path and no flow, said so.
  await page.getByRole('button', {name: 'Filters and views'}).click();
  await page.getByRole('group', {name: 'Side panel'}).getByRole('button', {name: 'Variants', exact: true}).click();
  const rank = variants.variants.findIndex(variant => variant.activities.length === 0) + 1;
  await page.getByRole('button', {name: `Preview keeping the 1 incident of variant ${rank}`}).click();
  await page.getByRole('group', {name: `Variant ${rank} not yet applied`}).getByRole('button', {name: 'Apply', exact: true}).click();
  await settled(1);
  check('empty_selection_kept', same(selections.at(-1).kept.case_ids, expected.empty_variant_members), selections.at(-1).kept);
  await page.getByText('The kept incidents have no path between two activities and no flow from Start or to End.').waitFor();
  check('empty_list_said', true);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
