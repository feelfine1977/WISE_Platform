// The built browser through the Time measure of the map (#86) over the invented tests/fixtures/lag-classes file, at
// 1280 x 720: the busy path of zero lag is drawn in the neutral grey of the legend's first class and never in blue, the
// 30-hour path in the second class and the rare slow path in the third; the legend names the classes with their bounds
// as durations.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1280, height: 720}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const pathId = (source, target) => `path.v1:sha256:${createHash('sha256').update(JSON.stringify([source, target]), 'utf8').digest('hex')}`;

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await page.getByRole('navigation', {name: 'Areas'}).getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Map', exact: true}).click();
  const map = page.getByLabel('Process map of the kept cases');
  await map.waitFor();
  await page.getByRole('group', {name: 'What the map counts'}).getByRole('button', {name: 'Time on the map', exact: true}).click();
  // The stroke of every path in the Time measure, and what the legend says.
  await page.waitForFunction(id => !!document.querySelector(`[data-id="${id}"] path`), pathId('Received', 'Logged'));
  const strokes = await page.evaluate(ids => Object.fromEntries(Object.entries(ids).map(([name, id]) => {
    const path = [...document.querySelectorAll(`[data-id="${id}"] path`)].find(element => getComputedStyle(element).stroke !== 'none' && element.getAttribute('stroke') !== 'transparent');
    return [name, path ? getComputedStyle(path).stroke : null];
  })), Object.fromEntries(Object.keys(expected.paths).map(name => [name, pathId(...name.split('>'))])));
  // The whole legend: the classes with their bounds and their swatches.
  const strip = page.locator('.wf-legend').filter({hasText: 'Performance: median wait between activities'}).first();
  await strip.getByRole('button', {name: 'Show the whole legend'}).click();
  const swatches = await page.locator('.wf-legend .wf-legend__swatch').evaluateAll(items => items.map(item => [getComputedStyle(item).backgroundColor, item.parentElement?.textContent?.trim()]));
  check('legend_names_the_classes_as_durations', JSON.stringify(swatches.map(([, text]) => text)) === JSON.stringify(expected.legend), swatches);
  const classColour = place => swatches[place]?.[0];
  for (const [name, path] of Object.entries(expected.paths)) {
    check(`${name}_drawn_in_its_class`, strokes[name] === classColour(path.class), {stroke: strokes[name], wanted: classColour(path.class)});
  }
  const [neutral, blue, darker] = [0, 1, 2].map(classColour);
  const isBlue = colour => { const [r, g, b] = colour.match(/\d+/g).map(Number); return b > r + 40 && b > g; };
  check('busy_zero_lag_path_never_blue', strokes['Received>Logged'] === neutral && !isBlue(neutral) && isBlue(blue) && isBlue(darker) && new Set([neutral, blue, darker]).size === 3, {neutral, blue, darker});
  if (process.env.WISE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.WISE_SCREENSHOT_DIR}/issue86-lag-classes-1280x720.png`});
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
