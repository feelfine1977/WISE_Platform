// The built browser through a readable opening for a large map (#65), at 1280 x 720 and at a wider window, over a prepared
// reading the caller names: the map opens near Start at a readable zoom with the overview and says how much of it is in view;
// zoomed out it stops at the smallest readable zoom, where every name on the screen is still readable; "Fit the map" shows the
// whole map where that stays readable and otherwise the map from Start at that zoom; an omitted low-frequency path is found in
// the list of every path, drawn on the map and brought into view, and the opening is returned to by pointer and by keyboard;
// a loop is drawn both ways; activities shortened alike are told apart; stages are collapsed and expanded; a path is selected.
// Arranged for what is shown, the detail arranges the map anew and opens it again; the parent's places, kept on request, hold
// through the detail. Through all of it no incident, count, step or identity changes, and every request stays on this host.
// The report holds checks, counts and sizes only.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const label = config.label;
const nodeId = name => `activity.v1:sha256:${createHash('sha256').update(name, 'utf8').digest('hex')}`;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const shots = process.env.WISE_SCREENSHOT_DIR;
const SIZES = [{width: 1280, height: 720}, {width: 1600, height: 900}];
/** The smallest text the map library keeps on the screen, in CSS pixels, less what rounding takes. */
const READABLE_PX = 9 - 0.5;
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const report = {label, checks, sizes: {}};

/** The opening, the smallest readable zoom and the fit at one window size, and the frame's sizes. */
async function journey(size) {
  const context = await browser.newContext({viewport: size});
  const page = await context.newPage();
  page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 120000));
  const tag = `${size.width}x${size.height}`;
  const errors = [], selections = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  // The analytic answers: selections taken (a preview of a step is no step and no change) and process graphs.
  let graphs = 0;
  page.on('response', async response => {
    const route = new URL(response.url()).pathname;
    if (route === '/api/investigations/process-graph' && response.ok()) graphs++;
    if (route !== '/api/investigations/select-cases' || !response.ok()) return;
    const answer = await response.json().catch(() => null);
    if (answer && !answer.request_id.startsWith('preview-')) selections.push(answer);
  });
  const sized = {};
  report.sizes[tag] = sized;
  const name = part => `${label}_${tag}_${part}`;
  const shot = async part => { if (shots) await page.screenshot({path: `${shots}/issue65-${label}-${tag}-${part}.png`}); };
  const areas = page.getByRole('navigation', {name: 'Areas'});
  const view = text => page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: text, exact: true});
  const analytic = () => selections.length + graphs;
  const map = () => page.getByLabel('Process map of the kept cases');
  const zoomButton = text => map().getByRole('button', {name: text, exact: true});
  const tool = text => page.getByRole('group', {name: 'Map tools'}).getByRole('button', {name: text, exact: true});
  const rest = (ms = 900) => page.waitForTimeout(ms);
  /** The view of the map: where its picture is moved to and at which zoom. */
  const viewOf = () => page.evaluate(() => {
    const m = document.querySelector('.react-flow__viewport')?.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\) scale\(([-\d.e]+)\)/);
    return m ? {x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3])} : null;
  });
  const box = selector => page.evaluate(selector => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return {x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)};
  }, selector);
  const within = (inner, outer) => inner && outer && inner.x + inner.width > outer.x && inner.x < outer.x + outer.width && inner.y + inner.height > outer.y && inner.y < outer.y + outer.height;
  /** The disclosure of the detail strip: how many activities and paths are in view, of all; null while the whole map is in view. */
  const disclosed = async () => {
    const text = await page.locator('.map-detail [data-testid="wf-in-view"]').textContent().catch(() => null);
    const m = text?.match(/^([\d,]+) of ([\d,]+) activities and ([\d,]+) of ([\d,]+) paths in view$/);
    return m ? {nodes: Number(m[1].replace(/,/g, '')), ofNodes: Number(m[2].replace(/,/g, '')), edges: Number(m[3].replace(/,/g, '')), ofEdges: Number(m[4].replace(/,/g, ''))} : null;
  };
  /** The smallest name on the screen, in CSS pixels as drawn (its font size times the scale of everything around it), over the cards in the frame. */
  const smallestName = () => page.evaluate(() => {
    const frame = document.querySelector('.map-frame').getBoundingClientRect();
    const level = [...document.querySelector('[data-wf-part="map"]').classList].find(c => c.startsWith('wf-text--'))?.slice(9) ?? 'plain';
    const sizes = [];
    for (const span of document.querySelectorAll(`.react-flow__node .wf-copy--${level} [data-wf-part="node-label"] > span`)) {
      const r = span.getBoundingClientRect();
      if (!r.height || !span.offsetHeight || r.right < frame.x || r.left > frame.x + frame.width || r.bottom < frame.y || r.top > frame.y + frame.height) continue;
      sizes.push(parseFloat(getComputedStyle(span).fontSize) * r.height / span.offsetHeight);
    }
    return {level, count: sizes.length, smallest: sizes.length ? Math.min(...sizes) : null};
  });
  /** Where every drawn activity stands, by its id. */
  const startInView = async () => within(await box('[data-id="event:start"]'), await box('.map-frame'));
  const overviewShown = () => page.getByRole('application', {name: 'Overview of the map'}).isVisible().catch(() => false);

  try {
    await page.goto(base);
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
    await page.waitForFunction(n => (document.querySelector('.population')?.textContent ?? '').includes(`${n.toLocaleString('en')} of ${n.toLocaleString('en')} cases`), expected.incidents);
    await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);

    // ---- the opening ----
    await view('Map').click();
    await map().waitFor();
    await page.waitForFunction(() => ['given', 'ready'].includes(document.querySelector('[data-wf-part="map"]')?.getAttribute('data-layout-status')));
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node-activity').length > 0);
    await rest(1500);
    const identity = selections.at(-1).identity;
    const requestsAtOpening = analytic();
    const opening = await viewOf();
    const detail = (await page.locator('.map-detail').textContent()) ?? '';
    const disclosure = await disclosed();
    const names = await smallestName();
    sized.frame = await box('.map-frame');
    sized.opening = {zoom: opening.zoom, disclosure, names, overview: await overviewShown(), start_in_view: await startInView()};
    check(name('opens_readable_near_start'), opening.zoom >= 0.74 && sized.opening.start_in_view, sized.opening);
    check(name('opening_says_detail_of_all'), new RegExp(`of ${expected.activities} activities`).test(detail), detail.slice(0, 300));
    check(name('opening_discloses_part_in_view'), disclosure !== null && disclosure.nodes > 0 && disclosure.nodes < disclosure.ofNodes && disclosure.edges <= disclosure.ofEdges, disclosure);
    check(name('opening_shows_overview'), sized.opening.overview, null);
    check(name('opening_names_readable'), names.count > 0 && names.smallest >= READABLE_PX, names);
    await shot('opening');

    // ---- the smallest readable zoom ----
    for (let i = 0; i < 14; i++) await zoomButton('Zoom out').click();
    await rest();
    const floor = (await viewOf()).zoom;
    const atFloor = await smallestName();
    sized.floor = {zoom: floor, names: atFloor, disclosure: await disclosed()};
    check(name('zoom_stops_at_a_readable_floor'), floor > 0.15 && floor < opening.zoom, sized.floor);
    check(name('names_readable_at_the_floor'), atFloor.count > 0 && atFloor.smallest >= READABLE_PX && atFloor.level !== 'box', atFloor);
    await shot('floor');

    // ---- the fit: the whole map where it stays readable, else from Start at the floor ----
    await zoomButton('Zoom in').click();
    await rest(400);
    await zoomButton('Fit the map').click();
    await rest();
    const fitted = await viewOf();
    const fitDisclosure = await disclosed();
    const fitNames = await smallestName();
    sized.fit = {zoom: fitted.zoom, disclosure: fitDisclosure, names: fitNames, start_in_view: await startInView(), overview: await overviewShown()};
    const whole = fitDisclosure === null;
    check(name('fit_stays_readable'), fitted.zoom >= floor - 1e-6 && fitNames.smallest >= READABLE_PX && (whole ? fitted.zoom > floor + 1e-6 : Math.abs(fitted.zoom - floor) < 1e-3 && sized.fit.start_in_view && sized.fit.overview), sized.fit);
    await shot('fit');

    // ---- the frame with the panel of a selected activity open ----
    await tool('Back to the opening').click();
    await rest();
    // An activity in view: the first whose card lies inside the frame.
    const inView = await page.evaluate(() => {
      const frame = document.querySelector('.map-frame').getBoundingClientRect();
      return [...document.querySelectorAll('.react-flow__node-activity')].map(node => ({id: node.dataset.id, r: node.getBoundingClientRect()}))
        .find(({r}) => r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom)?.id ?? null;
    });
    check(name('an_activity_in_view'), inView !== null, null);
    await page.locator(`[data-id="${inView}"]`).click();
    await page.getByRole('heading', {name: /^Activity “/}).waitFor();
    sized.frame_with_element_pane = await box('.map-frame');
    await page.keyboard.press('Escape');
    check(name('viewport_changes_keep_identity'), same(selections.at(-1).identity, identity) && analytic() === requestsAtOpening, {analytic: analytic(), at: requestsAtOpening});
  } finally {
    await context.close();
  }
}

/** The rest of the journey at the first size, on a fresh page: the omitted path, the return to the opening, the loop, the names and the detail's new arrangement, the parent's places, the stages, a selected path. */
async function wholeJourney(size) {
  const context = await browser.newContext({viewport: size});
  const page = await context.newPage();
  page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 120000));
  const tag = `${size.width}x${size.height}`;
  const errors = [], selections = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  // The analytic answers: selections taken (a preview of a step is no step and no change) and process graphs.
  let graphs = 0;
  page.on('response', async response => {
    const route = new URL(response.url()).pathname;
    if (route === '/api/investigations/process-graph' && response.ok()) graphs++;
    if (route !== '/api/investigations/select-cases' || !response.ok()) return;
    const answer = await response.json().catch(() => null);
    if (answer && !answer.request_id.startsWith('preview-')) selections.push(answer);
  });
  const sized = report.sizes[tag];
  const name = part => `${label}_${tag}_${part}`;
  const shot = async part => { if (shots) await page.screenshot({path: `${shots}/issue65-${label}-${tag}-${part}.png`}); };
  const areas = page.getByRole('navigation', {name: 'Areas'});
  const view = text => page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: text, exact: true});
  const analytic = () => selections.length + graphs;
  const map = () => page.getByLabel('Process map of the kept cases');
  const zoomButton = text => map().getByRole('button', {name: text, exact: true});
  const tool = text => page.getByRole('group', {name: 'Map tools'}).getByRole('button', {name: text, exact: true});
  const rest = (ms = 900) => page.waitForTimeout(ms);
  const viewOf = () => page.evaluate(() => {
    const m = document.querySelector('.react-flow__viewport')?.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\) scale\(([-\d.e]+)\)/);
    return m ? {x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3])} : null;
  });
  const box = selector => page.evaluate(selector => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return {x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)};
  }, selector);
  const within = (inner, outer) => inner && outer && inner.x + inner.width > outer.x && inner.x < outer.x + outer.width && inner.y + inner.height > outer.y && inner.y < outer.y + outer.height;
  const disclosed = async () => {
    const text = await page.locator('.map-detail [data-testid="wf-in-view"]').textContent().catch(() => null);
    const m = text?.match(/^([\d,]+) of ([\d,]+) activities and ([\d,]+) of ([\d,]+) paths in view$/);
    return m ? {nodes: Number(m[1].replace(/,/g, '')), ofNodes: Number(m[2].replace(/,/g, '')), edges: Number(m[3].replace(/,/g, '')), ofEdges: Number(m[4].replace(/,/g, ''))} : null;
  };
  const places = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.react-flow__node-activity')].map(n => [n.dataset.id, n.style.transform])));
  const startInView = async () => within(await box('[data-id="event:start"]'), await box('.map-frame'));
  const shownName = id => page.evaluate(id => {
    const level = [...document.querySelector('[data-wf-part="map"]').classList].find(c => c.startsWith('wf-text--'))?.slice(9) ?? 'plain';
    const node = document.querySelector(`[data-id="${id}"]`);
    return node ? [...node.querySelectorAll(`.wf-copy--${level} [data-wf-part="node-label"] > span`)].map(s => s.textContent).join('\n') : null;
  }, id);
  const selectedEdgeBox = () => page.evaluate(() => {
    const edge = document.querySelector('.react-flow__edge.selected');
    if (!edge) return null;
    const r = edge.getBoundingClientRect();
    return {x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)};
  });
  const pathRow = (from, to) => page.getByRole('table', {name: 'Paths of the kept cases'}).getByRole('button', {name: `Path from “${from}” to “${to}”`, exact: true});

  try {
    await page.goto(base);
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
    await page.waitForFunction(n => (document.querySelector('.population')?.textContent ?? '').includes(`${n.toLocaleString('en')} of ${n.toLocaleString('en')} cases`), expected.incidents);
    await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
    await view('Map').click();
    await map().waitFor();
    await page.waitForFunction(() => ['given', 'ready'].includes(document.querySelector('[data-wf-part="map"]')?.getAttribute('data-layout-status')));
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node-activity').length > 0);
    await rest(1500);
    const identity = selections.at(-1).identity;
    const requestsAtOpening = analytic();
    const selectionsAtOpening = selections.length;
    const opening = await viewOf();
    const placesAtOpening = await places();
    const steps = () => page.locator('ul[aria-label="Steps of the selection"] > li').count();

    // ---- an omitted low-frequency path: found in the list, drawn on the map and brought into view ----
    await view('Paths').click();
    const table = page.getByRole('table', {name: 'Paths of the kept cases'});
    await table.waitFor();
    const incidentsHead = table.getByRole('button', {name: 'Cases: sort the list', exact: true});
    await incidentsHead.click();
    await incidentsHead.click();
    // A path between two activities (not a flow from Start or to End) the detail leaves out, with the fewest incidents.
    const omitted = table.locator('tbody tr', {has: page.locator('td[title="Not drawn"]')}).filter({has: page.locator('button.path-row[aria-label^="Path from"]')}).first();
    const omittedTitle = await omitted.locator('button.path-row').getAttribute('aria-label');
    const omittedIncidents = Number(((await omitted.locator('td.number').first().textContent()) ?? '').replace(/,/g, ''));
    await omitted.locator('button.path-row').click();
    await page.getByRole('heading', {name: omittedTitle, exact: true}).waitFor();
    await page.getByRole('button', {name: 'Draw on the map', exact: true}).click();
    await map().waitFor();
    await rest(1500);
    const revealed = {title_known: Boolean(omittedTitle), incidents: omittedIncidents, edge: await selectedEdgeBox(), frame: await box('.map-frame'), zoom: (await viewOf()).zoom};
    sized.revealed = {incidents: omittedIncidents, in_view: within(revealed.edge, revealed.frame), zoom: revealed.zoom};
    const limit = (await page.locator('.map-detail .map-limit').allTextContents()).join(' ');
    check(name('omitted_path_drawn_and_brought_into_view'), sized.revealed.in_view && /1 path drawn on request beyond the detail/.test(limit) && revealed.zoom >= sized.floor.zoom - 1e-6, {...sized.revealed, limit});
    check(name('revealed_path_inspected'), (await page.getByRole('heading', {name: omittedTitle, exact: true}).count()) === 1 && (await page.locator('.map-element').textContent()).includes('Keep cases'), null);
    await shot('revealed');

    // ---- back to the opening by pointer, then by keyboard ----
    await tool('Back to the opening').click();
    await rest();
    const byPointer = await viewOf();
    check(name('back_to_the_opening_by_pointer'), Math.abs(byPointer.zoom - opening.zoom) < 1e-3 && (await startInView()), byPointer);
    await zoomButton('Zoom in').click();
    await rest(400);
    await tool('Back to the opening').focus();
    await page.keyboard.press('Enter');
    await rest();
    const byKeyboard = await viewOf();
    check(name('back_to_the_opening_by_keyboard'), Math.abs(byKeyboard.zoom - opening.zoom) < 1e-3 && (await startInView()), byKeyboard);

    // ---- a loop, drawn both ways ----
    const [there, back] = expected.loop;
    await view('Paths').click();
    await table.waitFor();
    for (const [from, to] of [[there, back], [back, there]]) {
      const row = pathRow(from, to);
      await row.click();
      const button = page.getByRole('button', {name: /^(Draw|Show) on the map$/});
      await button.click();
      await map().waitFor();
      await rest(1200);
      await view('Paths').click();
      await table.waitFor();
    }
    await view('Map').click();
    await map().waitFor();
    await rest(1200);
    const loopEdges = await page.evaluate(([a, b]) => [...document.querySelectorAll('.react-flow__edge')].map(e => e.getAttribute('aria-label') ?? '').filter(text => text.includes(`${a} → ${b}`) || text.includes(`${b} → ${a}`)).length, [there, back]);
    check(name('loop_drawn_both_ways'), loopEdges === 2, loopEdges);
    await shot('loop');

    // ---- activities shortened alike are told apart ----
    const activities = page.getByRole('slider', {name: 'Activities'});
    await activities.focus();
    await page.keyboard.press('End');
    await rest(1500);
    const told = [];
    for (const [a, b] of expected.colliding) {
      const [shownA, shownB] = [await shownName(nodeId(a)), await shownName(nodeId(b))];
      const labels = await page.evaluate(([ia, ib]) => [ia, ib].map(id => document.querySelector(`[data-id="${id}"] [aria-label]`)?.getAttribute('aria-label') ?? document.querySelector(`[data-id="${id}"]`)?.getAttribute('aria-label') ?? ''), [nodeId(a), nodeId(b)]);
      told.push({shown: [shownA, shownB], named_in_full: labels[0].includes(a) && labels[1].includes(b)});
    }
    sized.told_apart = told;
    check(name('activities_shortened_alike_told_apart'), told.every(pair => pair.shown[0] && pair.shown[1] && pair.shown[0] !== pair.shown[1] && pair.named_in_full), told);
    await shot('all-activities');
    // ---- arranged for what is shown: the detail arranged the map anew and opened it again, readable ----
    const placesAtAll = await places();
    const rearranged = Object.keys(placesAtOpening).filter(id => id in placesAtAll && placesAtAll[id] !== placesAtOpening[id]);
    const reopened = await viewOf();
    sized.rearranged = {moved: rearranged.length, of_the_opening: Object.keys(placesAtOpening).length, zoom: reopened.zoom, start_in_view: await startInView()};
    check(name('detail_arranges_anew_and_opens_again'), rearranged.length > 0 && sized.rearranged.start_in_view && reopened.zoom >= sized.floor.zoom - 1e-6, sized.rearranged);

    // ---- the parent's places, kept on request: the detail then moves no activity that stays, and every one comes back in its place ----
    await page.getByRole('button', {name: "Keep the parent's places", exact: true}).click();
    await page.getByRole('button', {name: 'Rearrange for this view', exact: true}).waitFor();
    await page.waitForFunction(() => !document.querySelector('.map-arranging') && document.querySelectorAll('.react-flow__node-activity').length > 0, null, {timeout: 60000});
    await rest(1500);
    const placesInPlace = await places();
    await activities.focus();
    await page.keyboard.press('Home');
    await rest(1500);
    const placesFewer = await places();
    const movedFewer = Object.keys(placesFewer).filter(id => !(id in placesInPlace) || placesFewer[id] !== placesInPlace[id]);
    await page.keyboard.press('End');
    await rest(1500);
    const placesAgain = await places();
    const movedBack = Object.keys(placesAgain).filter(id => placesAgain[id] !== placesInPlace[id]);
    sized.parent_places = {shown: Object.keys(placesInPlace).length, shown_at_the_lowest_detail: Object.keys(placesFewer).length, moved_at_the_lowest_detail: movedFewer.length, moved_back: movedBack.length};
    check(name('parent_places_fixed'), sized.parent_places.shown_at_the_lowest_detail > 0 && sized.parent_places.shown_at_the_lowest_detail < sized.parent_places.shown && movedFewer.length === 0 && movedBack.length === 0 && same(Object.keys(placesAgain).sort(), Object.keys(placesInPlace).sort()), sized.parent_places);

    // ---- stages collapsed and expanded: stages shape the arrangement anew, by design ----
    if (config.phase_column) {
      await page.getByRole('group', {name: 'Map tools'}).getByRole('button', {name: 'Edit stages'}).click();
      const editor = page.getByRole('region', {name: 'Stages of this log'});
      await editor.getByLabel('Phase column', {exact: true}).selectOption({label: config.phase_column});
      await editor.getByRole('button', {name: 'Count the values', exact: true}).click();
      await editor.getByRole('button', {name: /^Take the proposal for \d+ activities/}).click();
      await page.getByRole('button', {name: 'Close the editor of the stages'}).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-wf-part="group"][data-wf-kind="stage"]').length >= 2, null, {timeout: 60000});
      await rest(1500);
      await page.getByRole('button', {name: 'Show stages', exact: true}).click();
      await page.waitForFunction(() => document.querySelectorAll('.react-flow__node[data-kind="stage"], .react-flow__node-stage').length >= 2, null, {timeout: 60000});
      await rest(1500);
      const collapsed = {stage_nodes: await page.locator('.react-flow__node-stage').count(), disclosure: await disclosed()};
      await shot('stages');
      await page.getByRole('button', {name: 'Show activities', exact: true}).click();
      await rest(1500);
      sized.stages = {collapsed, expanded_activities: await page.locator('.react-flow__node-activity').count()};
      check(name('stages_collapsed_and_expanded'), collapsed.stage_nodes >= 2 && sized.stages.expanded_activities === expected.activities, sized.stages);
    }

    // ---- a selected path, and nothing else changed: a drawn path chosen in the list is shown selected on the map ----
    await view('Paths').click();
    await table.waitFor();
    const drawnRow = table.locator('tbody tr', {has: page.locator('td[title="Drawn"]')}).first();
    const drawnTitle = await drawnRow.locator('button.path-row').getAttribute('aria-label');
    await drawnRow.locator('button.path-row').click();
    await page.getByRole('button', {name: 'Show on the map', exact: true}).click();
    await map().waitFor();
    await rest();
    await page.getByRole('heading', {name: drawnTitle, exact: true}).waitFor();
    check(name('selected_path_shown'), (await page.locator('.react-flow__edge.selected').count()) === 1 && drawnTitle.startsWith('Path from'), drawnTitle);
    await shot('selected-path');
    check(name('nothing_else_changed'), same(selections.at(-1).identity, identity) && analytic() === requestsAtOpening && (await steps()) === 0 && selections.length === selectionsAtOpening,
      {analytic: analytic(), at: requestsAtOpening, selections: selections.length, atOpening: selectionsAtOpening});
    const origin = new URL(base).origin;
    const elsewhere = requests.filter(url => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'));
    check(name('every_request_stays_on_the_local_host'), elsewhere.length === 0, elsewhere.slice(0, 5));
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

try {
  await journey(SIZES[0]);
  await wholeJourney(SIZES[0]);
  await journey(SIZES[1]);
} finally {
  // What was found, also of a journey that failed, so that the receipt's detail can say where.
  await writeFile(output, JSON.stringify(report));
  await browser.close();
}
