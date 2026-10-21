// The built browser through the places of the activities (#56) on the branching map of the invented
// tests/fixtures/variants file. The places are read from the map's own nodes, in the map's coordinates. A preview and
// its cancel, an applied step and its Undo, the lowest detail, an activity removed and brought back, and an incident read
// beside the map move no activity that stays; Rearrange and the way back are explicit, by keyboard, ask for no incident
// and change no identity; the direction is named; another parent (tests/fixtures/pinned) is arranged anew.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath, shots] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const [reading, other] = config.readings;
const variants = reading.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 768}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [], asked = {select: 0, graph: 0};
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const path = new URL(request.url()).pathname;
  if (path === '/api/investigations/select-cases') asked.select += 1;
  if (path === '/api/investigations/process-graph') asked.graph += 1;
});
page.on('response', async response => {
  if (new URL(response.url()).pathname !== '/api/investigations/select-cases' || !response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (answer && !answer.request_id.startsWith('preview-')) selections.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areas = page.getByRole('navigation', {name: 'Areas'});
const line = () => page.locator('.map-arrangement');
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
/** The places of the activities the map draws, by name, in the map's coordinates, once they stay still. */
async function places(names) {
  await page.waitForFunction(n => {
    const shown = [...document.querySelectorAll('.react-flow__node-activity')];
    return shown.length === n && !document.querySelector('.map-arranging') && !document.body.textContent.includes('Arranging the map');
  }, names.length);
  let last = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const now = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.react-flow__node-activity')].map(node => {
      const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(node.style.transform);
      return [node.getAttribute('data-id'), match ? [Math.round(Number(match[1])), Math.round(Number(match[2]))] : null];
    })));
    if (last !== null && same(now, last)) return now;
    last = now;
    await page.waitForTimeout(150);
  }
  return last;
}
const kept = (all, now) => Object.keys(now).every(id => same(now[id], all[id]));
async function shot(name) {
  await page.locator('.map-frame').screenshot({path: join(shots, `${name}.png`)});
}
const activities = ['Opened', 'Assigned', 'Resolved'];

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${reading.preparation_id}$`)}).click();
  await settled(0);
  await page.getByRole('group', {name: 'View'}).getByRole('button', {name: 'Map', exact: true}).click();
  const opening = await places(activities);
  const points = Object.values(opening);
  check('places_read_from_the_map', points.length === activities.length && points.every(point => Array.isArray(point)) && new Set(points.map(point => point.join(','))).size === points.length, opening);
  check('parent_places_named_with_their_origin_and_direction', (await line().textContent()).startsWith(`Places from the map of the parent's ${reading.incidents} incidents; they stay through previews, steps, Undo and the detail. Runs top to bottom.`), await line().textContent());
  await shot('parent-places');

  // A preview and its cancel, then an applied step and its Undo: no activity that stays moves.
  await page.getByRole('button', {name: 'Filters and views'}).click();
  await page.getByRole('group', {name: 'Side panel'}).getByRole('button', {name: 'Patterns', exact: true}).click();
  const first = variants.variants[0];
  await page.getByRole('button', {name: `Preview keeping the ${first.members.length} incidents of variant 1`}).click();
  const pending = page.getByRole('group', {name: 'Variant 1 not yet applied'});
  await pending.getByText(/^Preview:/).waitFor();
  check('preview_moves_nothing', same(await places(activities), opening), null);
  await pending.getByRole('button', {name: 'Cancel', exact: true}).click();
  check('cancel_moves_nothing', same(await places(activities), opening), null);
  await page.getByRole('button', {name: `Preview keeping the ${first.members.length} incidents of variant 1`}).click();
  await pending.getByRole('button', {name: 'Apply', exact: true}).click();
  await settled(1);
  const applied = await places(activities);
  check('applied_step_moves_no_kept_activity', kept(opening, applied), [opening, applied]);
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  check('undo_moves_nothing', same(await places(activities), opening), null);

  // An activity removed by a step comes back in its place.
  const without = variants.variants.find(variant => same(variant.activities, ['Opened', 'Resolved']));
  const rank = variants.variants.indexOf(without) + 1;
  await page.getByRole('button', {name: `Preview keeping the ${without.members.length} incident of variant ${rank}`}).click();
  await page.getByRole('group', {name: `Variant ${rank} not yet applied`}).getByRole('button', {name: 'Apply', exact: true}).click();
  await settled(1);
  const fewer = await places(['Opened', 'Resolved']);
  check('removed_activity_leaves_the_others_in_place', Object.keys(fewer).length === 2 && kept(opening, fewer), fewer);
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  check('returning_activity_comes_back_in_its_place', same(await places(activities), opening), null);

  // The lowest detail moves no activity that stays.
  const slider = page.getByRole('form', {name: 'Detail'}).getByRole('slider', {name: 'Paths'});
  await slider.focus();
  await page.keyboard.press('Home');
  check('detail_moves_nothing', kept(opening, await places(activities)), null);
  await page.keyboard.press('End');

  // An incident read beside the map moves nothing and replaces no parent.
  await page.getByRole('group', {name: 'View'}).getByRole('button', {name: 'Incidents', exact: true}).click();
  await page.locator('table tbody tr button.row-open').first().click();
  await page.getByRole('button', {name: 'Return to incidents', exact: true}).click();
  await page.getByRole('group', {name: 'View'}).getByRole('button', {name: 'Map', exact: true}).click();
  check('reading_an_incident_moves_nothing', same(await places(activities), opening) && (await line().textContent()).includes(`parent's ${reading.incidents} incidents`), null);

  // Rearrange and back, by keyboard: said, and no incident asked for, no identity changed.
  const before = {...asked};
  const answered = selections.length;
  await page.getByRole('button', {name: 'Rearrange for this view', exact: true}).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', {name: "Back to the parent's places", exact: true}).waitFor();
  check('rearrange_said_as_presentation', (await line().textContent()).startsWith('Arranged anew for what is shown; places change with each step or detail.'), await line().textContent());
  await places(activities);
  await shot('rearranged');
  await page.getByRole('button', {name: "Back to the parent's places", exact: true}).focus();
  await page.keyboard.press('Enter');
  check('back_restores_the_parent_places', same(await places(activities), opening), null);
  // No selection and no map is asked for, so the incidents, their numbers and the identity shown stay those of the parent.
  check('rearranging_asks_for_no_incident', same(asked, before) && selections.length === answered
    && await page.getByRole('list', {name: 'Steps of the selection'}).count() === 0, [asked, before]);

  // The direction is presentation, named in words.
  await page.getByRole('button', {name: 'Run the map left to right'}).click();
  await page.waitForFunction(() => document.querySelector('.map-arrangement')?.textContent?.includes('Runs left to right.'));
  await places(activities);
  await shot('left-to-right');
  await page.getByRole('button', {name: 'Run the map left to right'}).click();
  await page.waitForFunction(() => document.querySelector('.map-arrangement')?.textContent?.includes('Runs top to bottom.'));
  check('direction_named_and_asks_for_no_incident', same(asked, before), [asked, before]);

  // Another parent is arranged anew, from its own map.
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${other.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelector('.map-arrangement')?.textContent?.includes(`parent's ${n} incidents`), other.incidents);
  check('another_parent_arranged_anew', true);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
