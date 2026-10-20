// The built browser through the one entry of every step (#94) over the invented tests/fixtures/span-gap file: "+ Add
// step" opens a short list of the kinds of step and the line that says what a step is; each kind opens its form alone;
// applying adds the step at once, closes the panel and gives the focus back to the entry, and Undo takes it back; the side
// panel no longer holds the filters; the words are "Steps", "Add step" and "Variants".
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {addStep} from './add_step.mjs';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1280, height: 720}});
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
const KINDS = ['Incident numbers', 'Recorded time', 'A range of records, span or longest gap', 'First record in a period', 'Context values', 'A range of a number in a context column'];
// What each kind's form offers first: the proof that its own form, and only it, is open.
const FORMS = {
  'Incident numbers': 'Exact incident numbers', 'Recorded time': 'At least this many hours', 'A range of records, span or longest gap': 'Measure of the range',
  'First record in a period': 'First record from (included)', 'Context values': 'Exact context values',
};
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await page.getByRole('navigation', {name: 'Areas'}).getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length === 8);
  await settled(0);
  const parent = selections.at(-1);

  // The words: "Steps" over the bar, "+ Add step" above the views, and a side panel without the filters, with "Variants".
  check('words_steps_and_add_step', await page.getByRole('heading', {name: 'Steps', exact: true}).count() === 1 && await page.getByRole('button', {name: '+ Add step', exact: true}).count() === 1, null);
  await page.getByRole('button', {name: 'Filters and views'}).click();
  const tabs = await page.getByRole('group', {name: 'Side panel'}).getByRole('button').allTextContents();
  check('side_panel_without_the_filters_with_variants', !tabs.includes('Filters') && tabs.includes('Variants') && tabs.includes('Context'), tabs);
  await page.getByRole('button', {name: 'Hide the side panel'}).click();

  // The kinds of step, with the line that says what a step is.
  await page.getByRole('button', {name: '+ Add step', exact: true}).click();
  const panel = page.getByRole('group', {name: 'Add a step'});
  const kinds = await panel.getByRole('list', {name: 'Kinds of step'}).getByRole('button').allTextContents();
  check('kinds_of_step_listed', same(kinds, KINDS), kinds);
  check('glossary_line', (await panel.textContent()).includes('A step keeps or removes whole incidents'), null);
  // Each kind opens its own form alone.
  for (const kind of KINDS) {
    await addStep(page, kind);
    const own = kind in FORMS ? await panel.getByLabel(FORMS[kind]).isVisible() : (await panel.textContent()).includes('No context column was declared a number');
    const others = await Promise.all(Object.entries(FORMS).filter(([other]) => other !== kind).map(([, field]) => panel.getByLabel(field).count()));
    check(`form_of_${kind.replaceAll(' ', '_').replaceAll(',', '')}_alone`, own && others.every(count => count === 0), others);
  }
  // Applying adds the step at once, closes the panel and gives the focus back; Undo takes it back.
  const time = await addStep(page, 'Recorded time');
  await time.getByLabel('At least this many hours').fill('2');
  const asked = selections.length;
  await time.getByRole('button', {name: 'Keep by recorded time', exact: true}).click();
  await settled(1);
  check('applied_at_once', selections.length === asked + 1 && selections.at(-1).predicate_results[0].predicate.kind === 'observed_span_at_least', selections.length - asked);
  check('panel_closed_and_focus_back_on_the_entry', await panel.count() === 0 && await page.evaluate(() => document.activeElement?.textContent) === '+ Add step', null);
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  check('undo_takes_it_back', same(selections.at(-1).identity, parent.identity), null);
  // Escape closes the panel without a step.
  await page.getByRole('button', {name: '+ Add step', exact: true}).click();
  await page.keyboard.press('Escape');
  check('escape_closes_without_a_step', await panel.count() === 0 && selections.length === asked + 2, selections.length - asked);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
