// The built browser through the bar of steps and its trail by keyboard (#96) over the invented tests/fixtures/span-gap
// file: Tab reaches each as one tab stop; the arrow keys, Home and End move within; Escape leaves for the views; after Undo,
// Redo and Clear all the focus stays on an action that can be used, after a new step it moves to the new chip, never to the
// page; a polite line says each change with the incidents kept.
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
const focused = () => page.evaluate(() => {
  const element = document.activeElement;
  return {label: element?.getAttribute('aria-label') ?? null, text: element?.textContent ?? '', tag: element?.tagName ?? '', inTrail: !!element?.closest('.trail'),
    chip: element?.tagName === 'SUMMARY' ? element.textContent : null, body: element === document.body};
});
const said = () => page.locator('.steps-announcement').textContent();
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

  // A new step: the focus moves to its chip, and the change is said with the incidents kept.
  await timeStep(2, 1);
  await page.waitForFunction(() => document.activeElement?.tagName === 'SUMMARY');
  check('new_step_focuses_its_chip', (await focused()).chip?.startsWith('1. Span ≥ 2 h'), await focused());
  check('step_added_said', (await said()) === 'Step added: Span ≥ 2 h. 5 of 8 incidents kept.', await said());
  await timeStep(10, 2);
  await page.waitForFunction(() => document.activeElement?.textContent?.startsWith('2. '));
  check('second_step_focuses_its_chip', true);

  // The trail is one tab stop: the arrow keys, Home and End move along it; Escape leaves for the views.
  await page.keyboard.press('ArrowLeft');
  check('trail_arrow_moves_to_the_earlier_chip', (await focused()).chip?.startsWith('1. '), await focused());
  await page.keyboard.press('Home');
  check('trail_home_reaches_the_parent', (await focused()).text.startsWith('Every incident of the parent'), await focused());
  const stops = await page.locator('.trail').evaluate(trail => [...trail.querySelectorAll('.trail-start button, li > details > summary')].filter(item => item.tabIndex === 0).length);
  check('trail_is_one_tab_stop', stops === 1, stops);
  await page.keyboard.press('Escape');
  check('escape_leaves_the_trail_for_the_views', (await focused()).text === 'Incidents', await focused());

  // Tab reaches the bar; the arrow keys move between the actions that can be used.
  await page.keyboard.press('Shift+Tab');
  let tries = 0;
  while ((await focused()).label !== 'Undo' && tries++ < 12) await page.keyboard.press('Tab');
  check('tab_reaches_the_bar', (await focused()).label === 'Undo', await focused());
  await page.keyboard.press('ArrowRight');
  check('bar_arrow_moves_to_the_next_usable_action', (await focused()).label === 'Clear all', await focused());
  await page.keyboard.press('Home');
  // Undo by keyboard: the focus stays on Undo, which can still be used, and the change is said.
  await page.keyboard.press('Enter');
  await settled(1);
  await page.waitForFunction(() => /^Undone/.test(document.querySelector('.steps-announcement')?.textContent ?? ''));
  check('undo_keeps_the_focus_on_undo', (await focused()).label === 'Undo', await focused());
  check('undone_said', (await said()) === 'Undone: Span ≥ 10 h. 5 of 8 incidents kept.', await said());
  // Clear all: Clear all can no longer be used; the focus goes to an action that can.
  await page.keyboard.press('End');
  check('end_reaches_clear_all', (await focused()).label === 'Clear all', await focused());
  await page.keyboard.press('Enter');
  await settled(0);
  await page.waitForFunction(() => /^Every step removed/.test(document.querySelector('.steps-announcement')?.textContent ?? ''));
  const afterClear = await focused();
  check('focus_never_lost_after_clear_all', !afterClear.body && afterClear.label === 'Undo', afterClear);
  check('cleared_said', (await said()) === 'Every step removed. 8 of 8 incidents kept.', await said());
  await page.keyboard.press('Escape');
  check('escape_leaves_the_bar_for_the_views', (await focused()).text === 'Incidents', await focused());
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
