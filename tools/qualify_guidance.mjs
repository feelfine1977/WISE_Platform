// The built browser through the line of guidance (#95) over the invented tests/fixtures/span-gap file: the empty state
// names the ways to a first step, each leading to its control (the map and the chart of starts get the focus, "+ Add
// step" opens); after the first step one line says how to undo or add another, and gives way for good once another step is
// taken; never two lines at once.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {addStep} from './add_step.mjs';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 768}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const lines = () => page.locator('.guide-line').allTextContents();
const link = name => page.locator('.guide-line').getByRole('button', {name, exact: true});
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
async function timeStep(hours, steps) {
  const time = await addStep(page, 'Recorded time');
  await time.getByLabel('At least this many hours').fill(String(hours));
  await time.getByRole('button', {name: 'Keep by recorded time', exact: true}).click();
  await settled(steps);
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await page.getByRole('navigation', {name: 'Areas'}).getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length === 8);
  await settled(0);
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Incidents', exact: true}).click();

  // The empty state: one line with the three ways, each leading to its control.
  const empty = await lines();
  check('empty_state_names_the_ways', empty.length === 1 && empty[0] === 'No step yet: every incident of the parent is kept. Take a first step: select an activity or a path on the map, drag over a period of starts, or add a step.', empty);
  await link('select an activity or a path on the map').click();
  await page.waitForFunction(() => !!document.activeElement?.closest('[aria-label="Process map of the kept incidents"]'));
  check('map_link_focuses_the_map', true);
  await link('drag over a period of starts').click();
  await page.waitForFunction(() => /^Incident starts per /.test(document.activeElement?.getAttribute('aria-label') ?? ''));
  check('starts_link_focuses_the_chart_of_starts', true);
  await link('add a step').click();
  check('add_link_opens_add_step', await page.getByRole('group', {name: 'Add a step'}).isVisible(), null);
  await page.keyboard.press('Escape');

  // After the first step: how to undo or add another, one line; it gives way for good after another step.
  await timeStep(2, 1);
  const after = await lines();
  check('after_the_first_step_one_line', after.length === 1 && after[0] === 'One step taken: Undo takes it back, or add another step.', after);
  await link('add another step').click();
  check('add_another_opens_add_step', await page.getByRole('group', {name: 'Add a step'}).isVisible(), null);
  await page.keyboard.press('Escape');
  await timeStep(5, 2);
  check('gives_way_after_another_step', (await lines()).length === 0, await lines());
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(1);
  check('does_not_come_back', (await lines()).length === 0, await lines());
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
