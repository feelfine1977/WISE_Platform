// The built browser through one imported investigation on one screen (#54) over the invented tests/fixtures/one-screen
// file, whose activities and file have long names. At 1280 x 720: Map, Incidents and Variants are named views; the map's
// detail controls stand above the canvas and its legend under it, with no panel on the canvas; an activity's steps and
// times stand beside the map; a step is previewed and let go, then taken and undone with the exact incidents and
// identities of the hand-written expected.json; three steps are each counted against the one frozen parent; the complete
// history of an incident is opened and closed with the keyboard back on its row; a pending, a failed and a let-go
// selection leave the answer shown. The page never scrolls and every core action is in view and not covered, with the
// side panel and a history open, at 1280 x 720 and at 1440 x 900; at 200 % zoom the page reflows without a sideways scroll
// and every core action can be reached. How long each answer and view took is recorded, without a claim of capacity.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const NAME = expected.activities;
const incidents = expected.incidents.length;
const nodeId = label => `activity.v1:sha256:${createHash('sha256').update(label, 'utf8').digest('hex')}`;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const checks = {};
const timings = {};
const measures = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const shots = process.env.WISE_SCREENSHOT_DIR;
const elapsed = start => Math.round(performance.now() - start);

/** A page on the reading of the fixture, with the answers of the selection it shows (previews left out). */
async function open(width, height, scale = 1) {
  const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: scale});
  page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
  const errors = [], selections = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => {
    if (new URL(response.url()).pathname !== '/api/investigations/select-cases' || !response.ok()) return;
    const answer = await response.json().catch(() => null);
    if (answer && !answer.request_id.startsWith('preview-')) selections.push(answer);
  });
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await page.getByRole('navigation', {name: 'Areas'}).getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, incidents);
  const session = {page, errors, selections};
  await settled(session, 0);
  return session;
}

async function settled({page}, steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}

/** The core actions of the investigation, by their names. */
function core(page) {
  const views = page.getByRole('group', {name: 'View', exact: true});
  const steps = page.getByRole('group', {name: 'Steps', exact: true});
  return {
    'Data': page.getByRole('navigation', {name: 'Breadcrumb'}).getByRole('button', {name: 'Data', exact: true}),
    'About this data': page.getByRole('button', {name: 'About this data', exact: true}),
    'Keys': page.getByRole('button', {name: 'Keys', exact: true}),
    'Save': page.getByRole('button', {name: 'Save', exact: true}),
    'Map': views.getByRole('button', {name: 'Map', exact: true}),
    'Incidents': views.getByRole('button', {name: 'Cases', exact: true}),
    'Variants': views.getByRole('button', {name: 'Variants', exact: true}),
    'Paths': views.getByRole('button', {name: 'Paths', exact: true}),
    'Matrix': views.getByRole('button', {name: 'Matrix', exact: true}),
    'Undo': steps.getByRole('button', {name: 'Undo', exact: true}),
    'Redo': steps.getByRole('button', {name: 'Redo', exact: true}),
    'Clear all': steps.getByRole('button', {name: 'Clear all', exact: true}),
    '+ Add step': page.getByRole('button', {name: '+ Add step', exact: true}),
    'Filters and views': page.getByRole('button', {name: 'Filters and views', exact: true}),
  };
}

/** Where an element stands: in the window, not cut by a part that scrolls or clips it, and not covered by anything else. */
const placed = locator => locator.evaluate(element => {
  const box = element.getBoundingClientRect();
  const inView = box.width > 0 && box.height > 0 && box.left >= -0.5 && box.top >= -0.5 && box.right <= innerWidth + 0.5 && box.bottom <= innerHeight + 0.5;
  let clippedBy = null;
  for (let parent = element.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (!/hidden|auto|scroll|clip/.test(`${style.overflowX} ${style.overflowY}`)) continue;
    const frame = parent.getBoundingClientRect();
    if (box.left < frame.left - 0.5 || box.right > frame.right + 0.5 || box.top < frame.top - 0.5 || box.bottom > frame.bottom + 0.5) { clippedBy = parent.className || parent.tagName; break; }
  }
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  const covered = !(hit && (hit === element || element.contains(hit)));
  return {inView, clippedBy, covered: covered ? (hit?.className || hit?.tagName || null) : false, box: [box.left, box.top, box.width, box.height].map(Math.round)};
});

/** Every core action in view and usable where it stands; with `scroll`, after scrolling it into view as the keyboard would. */
async function reachable(page, scroll = false) {
  const said = {};
  for (const [name, locator] of Object.entries(core(page))) {
    if (scroll) await locator.scrollIntoViewIfNeeded();
    said[name] = await placed(locator);
  }
  const failing = Object.fromEntries(Object.entries(said).filter(([, where]) => !where.inView || where.clippedBy || where.covered));
  return {ok: Object.keys(failing).length === 0, failing, said};
}

/** Whether the page itself scrolls, down or sideways. */
const pageScroll = page => page.evaluate(() => ({down: document.scrollingElement.scrollHeight > innerHeight + 1, sideways: document.scrollingElement.scrollWidth > innerWidth + 1,
  height: document.scrollingElement.scrollHeight, width: document.scrollingElement.scrollWidth}));

async function shot(page, name) {
  if (shots) await page.screenshot({path: `${shots}/issue54-${name}.png`});
}

async function view(page, name, ready) {
  const start = performance.now();
  await core(page)[name].click();
  await ready();
  timings[`view_${name.toLowerCase()}_ms`] = elapsed(start);
}

async function selectActivity(page, letter) {
  await page.locator(`[data-id="${nodeId(NAME[letter])}"]`).first().click();
  await page.getByRole('heading', {name: `Activity “${NAME[letter]}”`}).waitFor();
}

async function take({page, selections}, letter, choice, steps) {
  await selectActivity(page, letter);
  const before = selections.length;
  const start = performance.now();
  await page.getByRole('button', {name: choice, exact: true}).click();
  await settled({page}, steps);
  timings[`step_${steps}_ms`] = elapsed(start);
  assert.ok(selections.length > before, 'the step was answered');
  return selections.at(-1);
}

async function undo(session, steps) {
  const start = performance.now();
  await core(session.page)['Undo'].click();
  await settled(session, steps);
  return elapsed(start);
}

try {
  // ---- 1280 x 720 ----
  const laptop = await open(1280, 720);
  const {page, selections} = laptop;
  const parent = selections.at(-1);
  check('every_incident_of_the_reading_kept_at_first', same(parent.kept.case_ids, expected.incidents) && parent.kept.record_count === expected.record_count, parent.kept);
  check('page_does_not_scroll_at_1280x720', same(await pageScroll(page), {down: false, sideways: false, height: 720, width: 1280}), await pageScroll(page));

  // Two rows of scope: the source, the kept and parent counts and Save; then the views, the steps with Undo, Redo and Clear all, and "+ Add step".
  const rows = await page.evaluate(() => [document.querySelector('.explorer > .toolbar'), document.querySelector('.explorer > .selection-bar')]
    .map(row => ({height: Math.round(row.getBoundingClientRect().height), text: row.textContent})));
  measures.scope_rows_1280x720 = rows.map(row => row.height);
  check('first_scope_row_names_source_counts_and_save', rows[0].text.includes(expected.file) && rows[0].text.includes(`${incidents} of ${incidents} cases`)
    && rows[0].text.includes(`${expected.record_count} of ${expected.record_count} records`) && rows[0].text.includes('Save'), rows[0].text);
  check('second_scope_row_has_views_steps_and_actions', /Map.*Cases.*Variants.*Paths.*Matrix/.test(rows[1].text) && rows[1].text.includes('+ Add step')
    && await page.locator('.selection-bar').getByRole('group', {name: 'Steps', exact: true}).count() === 1, rows[1].text);
  // A question that is not scored shows no comparison roles or outcomes.
  check('no_comparison_roles_before_they_are_defined', !/\b(reference|comparison|outcome)\b/i.test(rows.map(row => row.text).join(' ')), rows.map(row => row.text));
  const first = await reachable(page);
  check('core_actions_in_view_at_1280x720', first.ok, first.failing);

  // ---- the map: its controls above the canvas, its legend under it, nothing of either on it ----
  await view(page, 'Map', () => page.getByLabel('Process map of the kept cases').waitFor());
  const parts = await page.evaluate(() => ({
    onCanvas: ['.wf-legend', '.wf-controls', '.wf-paths'].filter(part => document.querySelector(`.map-frame ${part}`)).length,
    controlsAbove: document.querySelectorAll('.map-detail .wf-controls').length,
    legendUnder: document.querySelectorAll('.map-legend .wf-legend').length,
    order: Array.from(document.querySelector('.map-main')?.children ?? [], part => part.className),
    legend: document.querySelector('.map-legend')?.textContent ?? '',
  }));
  check('canvas_holds_no_detail_controls_legend_or_path_list', parts.onCanvas === 0 && parts.controlsAbove === 1 && parts.legendUnder === 1
    && same(parts.order, ['map-detail', 'map-frame', 'map-legend']), parts);
  check('legend_under_the_map_names_the_measure', parts.legend.includes('Frequency'), parts.legend);
  // Long names: every activity is on the map, named in full for assistive technology, and their drawn labels differ.
  const labels = await page.evaluate(ids => ids.map(id => {
    const node = document.querySelector(`[data-id="${id}"]`);
    return {aria: node?.getAttribute('aria-label') ?? '', drawn: node?.innerText.replace(/\s+/g, ' ').trim() ?? ''};
  }), Object.values(NAME).map(nodeId));
  check('long_activity_names_named_in_full_and_drawn_distinct', labels.every((label, index) => label.aria.includes(Object.values(NAME)[index]))
    && new Set(labels.map(label => label.drawn)).size === labels.length, labels);
  check('page_does_not_scroll_with_the_map', !(await pageScroll(page)).down && !(await pageScroll(page)).sideways, await pageScroll(page));
  await shot(page, '1280x720-map');

  // ---- an activity's steps and times beside the map; a step previewed and let go ----
  await selectActivity(page, 'C');
  const drawer = await page.locator('.map-element').evaluate(panel => {
    const box = panel.getBoundingClientRect();
    return {inView: box.left >= 0 && box.right <= innerWidth + 0.5 && box.bottom <= innerHeight + 0.5, sideways: panel.scrollWidth > panel.clientWidth + 1,
      beside: box.left >= document.querySelector('.map-frame').getBoundingClientRect().right - 1, times: !!panel.querySelector('.activity-times-rows')};
  });
  check('selected_activity_steps_and_times_beside_the_map', drawer.inView && !drawer.sideways && drawer.beside && drawer.times, drawer);
  const withDrawer = await reachable(page);
  check('core_actions_in_view_with_the_steps_of_an_activity', withDrawer.ok, withDrawer.failing);
  const choice = page.locator('.map-choice').filter({has: page.getByRole('button', {name: 'Keep cases that contain it', exact: true})});
  await choice.locator('.step-preview').filter({hasText: /^Preview:/}).waitFor();
  const preview = await choice.locator('.step-preview').textContent();
  check('preview_proposes_the_oracles_membership', preview.startsWith(`Preview: would keep ${expected.contains_C.kept.length} cases of ${incidents} cases`), preview);
  const answeredBefore = selections.length;
  // Let go: a click on the empty map clears what is selected, and with it the step offered.
  await page.locator('.map-frame .react-flow__pane').click({position: {x: 4, y: 4}});
  await page.waitForFunction(() => document.querySelector('.map-element')?.classList.contains('visually-hidden'));
  check('preview_let_go_takes_no_step', selections.length === answeredBefore && (await page.locator('.population').textContent()).includes(`${incidents} of ${incidents} cases`), null);

  // ---- the step taken and undone, exactly ----
  const taken = await take(laptop, 'C', 'Keep cases that contain it', 1);
  check('step_keeps_the_oracles_incidents', same(taken.kept.case_ids, expected.contains_C.kept) && taken.kept.record_count === expected.contains_C.record_count
    && !same(taken.identity, parent.identity) && same(taken.parent_identity, parent.identity), taken.kept);
  timings.undo_ms = await undo(laptop, 0);
  check('undo_returns_to_the_parent_exactly', same(selections.at(-1).identity, parent.identity) && same(selections.at(-1).kept.case_ids, expected.incidents), selections.at(-1).identity);

  // ---- the variants: a named view of the centre ----
  await view(page, 'Variants', () => page.getByRole('region', {name: 'Variants of the kept cases'}).getByRole('list', {name: 'Variants, most cases first'}).waitFor());
  const pane = page.getByRole('region', {name: 'Variants of the kept cases'});
  const figures = await pane.locator('.variant-figures').evaluateAll(items => items.map(item => item.getAttribute('title')));
  check('variants_view_lists_the_oracles_variants', figures.length === expected.variants.count
    && same(figures.map(title => Number(title.split(' ')[0])), expected.variants.case_counts), figures);
  const listedBefore = selections.length;
  await pane.getByRole('button', {name: `List the ${expected.variants.first.case_ids.length} cases of variant 1 in the table`}).click();
  const listed = await page.getByRole('table', {name: 'Kept cases of variant 1'}).locator('tbody tr button.row-open').allTextContents();
  check('a_variant_lists_its_incidents_in_the_table_as_a_view', same(listed, expected.variants.first.case_ids) && selections.length === listedBefore
    && await core(page)['Incidents'].getAttribute('aria-pressed') === 'true', listed);
  await page.getByRole('button', {name: 'Show every case', exact: true}).click();
  await view(page, 'Paths', () => page.locator('.path-list').waitFor());
  await view(page, 'Matrix', () => page.locator('.matrix-pane').waitFor());
  await view(page, 'Cases', () => page.getByRole('table', {name: 'Kept cases'}).waitFor());

  // ---- the complete history of an incident, and back to its row ----
  const row = page.getByRole('table', {name: 'Kept cases'}).getByRole('button', {name: 'L-03', exact: true});
  const opening = performance.now();
  const [evidence] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/case-evidence'), row.click()]);
  await page.getByRole('heading', {name: 'Case L-03'}).waitFor();
  timings.history_ms = elapsed(opening);
  const history = await evidence.json();
  check('history_holds_every_record', history.case_id === 'L-03' && history.records.length === expected.records['L-03'] && same(history.identity, selections.at(-1).identity), history.records.length);
  const withHistory = await reachable(page);
  check('core_actions_in_view_with_a_history_open', withHistory.ok && !(await pageScroll(page)).down, withHistory.failing);
  await shot(page, '1280x720-history');
  const identityOpen = selections.at(-1).identity;
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.textContent === 'L-03');
  check('closing_the_history_gives_the_keyboard_back_to_its_row', await page.evaluate(() => document.activeElement?.textContent) === 'L-03'
    && same(selections.at(-1).identity, identityOpen) && await page.getByRole('heading', {name: 'Case L-03'}).count() === 0, null);

  // ---- three steps, each counted on its own against the one frozen parent ----
  await view(page, 'Map', () => page.getByLabel('Process map of the kept cases').waitFor());
  const plan = expected.three_steps.steps;
  let three;
  for (const [index, entry] of plan.entries()) three = await take(laptop, entry.activity, entry.choice, index + 1);
  check('three_steps_keep_the_oracles_incidents', same(three.kept.case_ids, expected.three_steps.kept) && same(three.parent_identity, parent.identity), three.kept.case_ids);
  check('each_step_counted_against_the_frozen_parent', same(three.predicate_results.map(result => result.kept.case_count), plan.map(entry => entry.kept_of_parent))
    && same(three.predicate_results.map(result => result.kept_after_step.case_count), plan.map(entry => entry.kept_after_step)), three.predicate_results.map(result => [result.kept.case_count, result.kept_after_step]));
  const chips = await page.getByRole('list', {name: 'Steps of the selection'}).locator(':scope > li').evaluateAll(items => items.map(item => item.querySelector('.chip-counts dd')?.textContent ?? ''));
  const overlap = await page.locator('.overlap-line').textContent();
  check('chips_say_each_steps_own_count_over_the_parent', chips.every((text, index) => text.startsWith(`${plan[index].kept_of_parent} cases`))
    && overlap.startsWith(`Each step is counted on its own over all ${incidents} cases of the parent.`), {chips, overlap});

  // ---- the side panel and a history open beside three steps, at both sizes ----
  await core(page)['Filters and views'].click();
  await page.getByRole('complementary', {name: 'Filters and views of the kept cases'}).waitFor();
  await view(page, 'Cases', () => page.getByRole('table', {name: 'Kept cases'}).waitFor());
  await page.getByRole('table', {name: 'Kept cases'}).getByRole('button', {name: 'L-09', exact: true}).click();
  await page.getByRole('heading', {name: 'Case L-09'}).waitFor();
  const crowded = await reachable(page);
  const crowdedRows = await page.evaluate(() => ['.explorer > .toolbar', '.explorer > .selection-bar'].map(part => Math.round(document.querySelector(part).getBoundingClientRect().height)));
  measures.scope_rows_1280x720_three_steps = crowdedRows;
  check('core_actions_in_view_with_steps_panel_and_history_at_1280x720', crowded.ok && same(await pageScroll(page), {down: false, sideways: false, height: 720, width: 1280}), crowded.failing);
  await shot(page, '1280x720-crowded');
  await page.setViewportSize({width: 1440, height: 900});
  await page.waitForTimeout(300);
  const wide = await reachable(page);
  check('core_actions_in_view_with_steps_panel_and_history_at_1440x900', wide.ok && same(await pageScroll(page), {down: false, sideways: false, height: 900, width: 1440}), wide.failing);
  measures.scope_rows_1440x900_three_steps = await page.evaluate(() => ['.explorer > .toolbar', '.explorer > .selection-bar'].map(part => Math.round(document.querySelector(part).getBoundingClientRect().height)));
  await shot(page, '1440x900-crowded');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.textContent === 'L-09');
  await page.setViewportSize({width: 1280, height: 720});

  // ---- pending, failed and let-go answers leave the answer shown ----
  let hold = null, fail = 0;
  await page.route('**/api/investigations/select-cases', async route => {
    const body = route.request().postDataJSON();
    if (body.request_id.startsWith('preview-')) return route.continue();
    if (fail > 0) { fail -= 1; return route.abort('connectionrefused'); }
    if (hold) await hold;
    return route.continue();
  });
  let release;
  hold = new Promise(done => { release = done; });
  await core(page)['Undo'].click();
  await page.waitForFunction(() => !!document.querySelector('.selection-status')?.textContent);
  const pending = await page.evaluate(() => ({status: document.querySelector('.selection-status')?.textContent, progress: !!document.querySelector('.explorer > .progress-line'),
    chips: document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length, kept: document.querySelector('.population')?.textContent}));
  check('pending_work_acknowledged_with_the_answer_still_shown', pending.progress && pending.status.length > 0 && pending.chips === 3
    && pending.kept.includes(`${expected.three_steps.kept.length} of ${incidents} cases`), pending);
  release();
  hold = null;
  await settled(laptop, 2);
  const twoSteps = selections.at(-1);
  fail = 1;
  await core(page)['Undo'].click();
  const alert = page.getByRole('alert').filter({hasText: 'the earlier selection is still shown'});
  await alert.waitFor();
  const failed = await page.evaluate(() => ({chips: document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length, kept: document.querySelector('.population')?.textContent}));
  check('failed_answer_names_the_answer_still_shown_and_offers_recovery', failed.chips === 2 && failed.kept.includes(`${twoSteps.kept.case_count} of ${incidents} cases`)
    && await alert.getByRole('button', {name: 'Try again'}).count() === 1 && await alert.getByRole('button', {name: 'Stay with the earlier selection'}).count() === 1, failed);
  await alert.getByRole('button', {name: 'Stay with the earlier selection'}).click();
  await alert.waitFor({state: 'detached'});
  await settled(laptop, 2);
  check('letting_the_new_answer_go_keeps_the_earlier_one', same(selections.at(-1).identity, twoSteps.identity)
    && (await page.locator('.population').textContent()).includes(`${twoSteps.kept.case_count} of ${incidents} cases`), null);
  fail = 1;
  await core(page)['Undo'].click();
  await alert.waitFor();
  await alert.getByRole('button', {name: 'Try again'}).click();
  await settled(laptop, 1);
  check('trying_again_answers_the_new_selection', selections.at(-1).predicate_results.length === 1, selections.at(-1).predicate_results.length);
  await page.unroute('**/api/investigations/select-cases');
  check('no_page_error_at_1280x720', laptop.errors.length === 0, laptop.errors);
  await page.close();

  // ---- 200 % zoom: the page reflows, nothing sideways, every core action reachable ----
  const zoomed = await open(640, 360, 2);
  const sideways = await pageScroll(zoomed.page);
  check('zoom_200_no_sideways_scroll', !sideways.sideways, sideways);
  const atZoom = await reachable(zoomed.page, true);
  check('zoom_200_every_core_action_reachable', atZoom.ok, atZoom.failing);
  await core(zoomed.page)['Incidents'].click();
  const zoomRow = zoomed.page.getByRole('table', {name: 'Kept cases'}).getByRole('button', {name: 'L-01', exact: true});
  await zoomRow.scrollIntoViewIfNeeded();
  await zoomRow.click();
  await zoomed.page.getByRole('heading', {name: 'Case L-01'}).waitFor();
  const back = zoomed.page.getByRole('button', {name: 'Return to cases'});
  await back.scrollIntoViewIfNeeded();
  const backPlaced = await placed(back);
  check('zoom_200_history_return_reachable', backPlaced.inView && !backPlaced.covered && !(await pageScroll(zoomed.page)).sideways, backPlaced);
  await shot(zoomed.page, 'zoom200-history');
  await back.click();
  await zoomed.page.waitForFunction(() => document.activeElement?.textContent === 'L-01');
  check('no_page_error_at_200_zoom', zoomed.errors.length === 0, zoomed.errors);
  await writeFile(output, JSON.stringify({checks, timings, measures}));
} finally {
  await browser.close();
}
