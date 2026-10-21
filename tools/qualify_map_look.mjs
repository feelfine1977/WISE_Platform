// The built browser through the look of the map and the explorer (#71) at 1280 x 720, over the invented
// tests/fixtures/map-look log of 240 incidents and 36 activities: the opening of a map larger than fits legibly; the
// counts and the times measures told apart and explained, changing what the map writes and nothing else; no expectation
// mark without a score run, said so; stages from a restrained palette, named on their boxes and in the legend; a filtered
// population that keeps nothing, said in place of the map; a complete incident history; the map with the side panel and
// the panel of a selected activity open. Every control stays readable and in view, the page never scrolls, and every
// request stays on this computer's host.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const nodeId = label => `activity.v1:sha256:${createHash('sha256').update(label, 'utf8').digest('hex')}`;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await (await browser.newContext({viewport: {width: 1280, height: 720}})).newPage();
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));
page.on('response', async response => {
  if (new URL(response.url()).pathname !== '/api/investigations/select-cases' || !response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (answer && !answer.request_id.startsWith('preview-')) selections.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const shots = process.env.WISE_SCREENSHOT_DIR;
const shot = async name => { if (shots) await page.screenshot({path: `${shots}/issue71-${name}.png`}); };
const areas = page.getByRole('navigation', {name: 'Areas'});
const view = name => page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name, exact: true});
const analytic = () => requests.filter(url => /\/api\/investigations\/(select-cases|process-graph)$/.test(new URL(url).pathname)).length;

async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
/** The page does not scroll, and the smallest text of the screen's controls and evidence is still readable. */
const screen = () => page.evaluate(() => {
  const sizes = [...document.querySelectorAll('.explorer button, .explorer label, .explorer p, .explorer td, .explorer th, .explorer dd, .explorer dt')]
    .filter(element => element.getClientRects().length > 0 && !element.closest('.visually-hidden') && !element.closest('.map-frame') && element.textContent.trim() !== '')
    .map(element => parseFloat(getComputedStyle(element).fontSize));
  return {down: document.scrollingElement.scrollHeight > innerHeight + 1, sideways: document.scrollingElement.scrollWidth > innerWidth + 1, smallest: Math.min(...sizes)};
});
const steady = (state, name) => check(`${name}_fits_and_reads`, !state.down && !state.sideways && state.smallest >= 12, state);
/** The colours of the paths drawn, as a sorted set. */
const strokes = () => page.locator('.react-flow__edge path.react-flow__edge-path, .react-flow__edge path').evaluateAll(paths => [...new Set(paths.map(path => getComputedStyle(path).stroke))].sort());

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  // The table renders only the rows in view; the data row says how many incidents are kept.
  await page.waitForFunction(n => (document.querySelector('.population')?.textContent ?? '').includes(`${n} of ${n} cases`), expected.incidents);
  await settled(0);

  // ---- the opening of a large map ----
  await view('Map').click();
  await page.getByLabel('Process map of the kept cases').waitFor();
  await page.locator(`[data-id="${nodeId(expected.first_activity)}"]`).first().waitFor();
  const detail = (await page.locator('.map-detail').textContent()) ?? '';
  check('large_map_opens_on_a_detail_it_says', /of 36 activities|of 36 events|36/.test(detail) && await page.locator('.map-frame .wf-legend, .map-frame .wf-controls').count() === 0
    && await page.locator('.map-legend .wf-legend').count() === 1, detail.slice(0, 400));
  steady(await screen(), 'large_map_opening');
  await shot('large-map');

  // ---- counts and times told apart and explained; nothing else changes ----
  const before = {analytic: analytic(), identity: selections.at(-1).identity, strokes: await strokes()};
  const legend = page.locator('.map-legend');
  const counted = (await legend.locator('.wf-legend__measure').textContent()) ?? '';
  await page.getByRole('button', {name: 'Time on the map', exact: true}).click();
  await page.waitForFunction(() => /Performance/.test(document.querySelector('.map-legend .wf-legend__measure')?.textContent ?? ''));
  const timed = (await legend.locator('.wf-legend__measure').textContent()) ?? '';
  const timedStrokes = await strokes();
  check('counts_and_times_distinguishable_and_explained', counted.startsWith('Frequency') && timed.startsWith('Performance') && !same(timedStrokes, before.strokes), {counted, timed, before: before.strokes, timedStrokes});
  check('appearance_changes_no_metric_or_selection', analytic() === before.analytic && same(selections.at(-1).identity, before.identity), null);
  await page.getByRole('button', {name: 'Cases on the map', exact: true}).click();

  // ---- no expectation mark without a score run, said so ----
  await page.getByRole('button', {name: 'About this map', exact: true}).click();
  const about = (await page.getByRole('group', {name: 'About this map'}).textContent()) ?? '';
  check('no_expectation_marks_without_a_run_said', about.includes('Shortfall has no values here: no expectation results are supplied to the map.')
    && !requests.some(url => new URL(url).pathname.startsWith('/api/expectations/score')), null);
  await page.keyboard.press('Escape');

  // ---- stages from a restrained palette, named on the map and in the legend ----
  await page.getByRole('group', {name: 'Map tools'}).getByRole('button', {name: 'Edit stages'}).click();
  const editor = page.getByRole('region', {name: 'Stages of this log'});
  await editor.getByLabel('Phase column', {exact: true}).selectOption({label: 'Phase'});
  await editor.getByRole('button', {name: 'Count the values', exact: true}).click();
  await editor.getByRole('button', {name: /^Take the proposal for 36 activities/}).click();
  await page.getByRole('button', {name: 'Close the editor of the stages'}).click();
  // The map opens on the most frequent activities: a stage gets its box where one of its activities is drawn.
  await page.waitForFunction(() => document.querySelectorAll('[data-wf-part="group"][data-wf-kind="stage"] [data-wf-part="group-label"]').length >= 2, null, {timeout: 30000});
  const boxes = (await page.locator('[data-wf-part="group"][data-wf-kind="stage"] [data-wf-part="group-label"]').allTextContents()).sort();
  await legend.getByRole('button', {name: 'Show the whole legend'}).click();
  const named = await legend.locator('.wf-legend__cat').allTextContents();
  const swatches = await legend.locator('.wf-legend__cat .wf-legend__swatch').evaluateAll(items => items.map(item => getComputedStyle(item).backgroundColor));
  const titles = await page.locator('[data-wf-part="group"][data-wf-kind="stage"]').evaluateAll(items => items.map(item => item.getAttribute('title')));
  check('stages_named_on_their_boxes_and_in_the_legend', boxes.length >= 2 && boxes.every(name => ['Early', 'Middle', 'Late'].includes(name)) && boxes.every(name => named.includes(name))
    && new Set(swatches).size === named.length && titles.every(title => /^(Early|Middle|Late), stage\. \d+ activities\.$/.test(title)), {boxes, named, swatches, titles});
  check('stages_change_no_metric_or_selection', analytic() === before.analytic && same(selections.at(-1).identity, before.identity), null);
  steady(await screen(), 'map_with_stages');
  await shot('stages');
  await legend.getByRole('button', {name: /legend/}).first().click();

  // ---- the map with the side panel and the panel of a selected activity open ----
  await page.getByRole('button', {name: 'Filters and views', exact: true}).click();
  await page.locator(`[data-id="${nodeId('Step 02')}"]`).first().click();
  await page.getByRole('heading', {name: 'Activity “Step 02”'}).waitFor();
  const frame = await page.locator('.map-frame').evaluate(element => { const box = element.getBoundingClientRect(); return [Math.round(box.width), Math.round(box.height)]; });
  check('map_keeps_room_with_panel_and_drawer_open', frame[0] >= 360 && frame[1] >= 280 && await legend.isVisible(), frame);
  steady(await screen(), 'map_with_panel_and_drawer');
  await shot('panel-and-drawer');

  // ---- a filtered population that keeps nothing ----
  await page.getByRole('button', {name: 'Keep cases that do not contain it', exact: true}).click();
  await settled(1);
  await page.locator(`[data-id="${nodeId(expected.first_activity)}"]`).first().click();
  await page.getByRole('button', {name: 'Keep cases that do not contain it', exact: true}).click();
  await settled(2);
  const empty = (await page.locator('.map-empty').textContent()) ?? '';
  check('empty_population_said_in_place_of_the_map', selections.at(-1).kept.case_count === 0 && empty.startsWith('The selection keeps no case of the 240 cases of its parent')
    && empty.includes('Remove a step or undo it') && await page.getByLabel('Process map of the kept cases').count() === 0, empty);
  steady(await screen(), 'empty_population');
  await shot('empty');
  await page.getByRole('group', {name: 'Steps', exact: true}).getByRole('button', {name: 'Clear all', exact: true}).click();
  await settled(0);

  // ---- a complete incident history ----
  await view('Cases').click();
  await page.getByRole('button', {name: 'Filters and views', exact: true}).click();
  const row = page.getByRole('table', {name: 'Kept cases'}).locator('tbody tr').first();
  const first = (await row.locator('button.row-open').textContent()) ?? '';
  const [evidence] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/case-evidence'), row.locator('button.row-open').click()]);
  await page.getByRole('heading', {name: `Case ${first}`}).waitFor();
  const records = (await evidence.json()).records.length;
  const history = await page.locator('.imported-inspector').evaluate(panel => ({entries: panel.querySelectorAll('ol.history > li').length, sideways: panel.scrollWidth > panel.clientWidth + 1}));
  check('complete_history_whole_and_readable', history.entries === records && records > 0 && !history.sideways, {history, records});
  steady(await screen(), 'complete_history');
  await shot('history');

  // ---- nothing leaves this computer ----
  const origin = new URL(base).origin;
  const elsewhere = requests.filter(url => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'));
  check('every_request_stays_on_the_local_host', elsewhere.length === 0, elsewhere.slice(0, 5));
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
