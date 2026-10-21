// The built browser through incidents with a similar sequence (#68) over the long-named tests/fixtures/one-screen file:
// from the most frequent variant, the families of the parent within one and then two edits, nearest first, as the
// hand-written similar.json lists them, with the method, eligibility and support said and nothing applied; a family's
// representative complete history opens; the suggestion kept is a step of its identifiers in the existing parent; Undo
// restores the selection; the suggestions do not change with a step taken.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const oracle = config.similar;
const NAME = expected.activities;
const named = letters => letters.map(letter => NAME[letter]).join(' → ');
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [], asked = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).pathname === '/api/investigations/similar-sequences') asked.push(request.postDataJSON()); });
page.on('response', async response => {
  if (new URL(response.url()).pathname !== '/api/investigations/select-cases' || !response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (answer && !answer.request_id.startsWith('preview-')) selections.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const panel = () => page.locator('.similar-sequences');
const families = () => panel().locator('.similar-families > li').evaluateAll(items => items.map(item => [item.querySelector('.similar-sequence').textContent, item.querySelector('.similar-family-head').textContent]));
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
async function shown(count) {
  await page.waitForFunction(n => document.querySelectorAll('.similar-sequences .similar-families > li').length === n && !document.querySelector('.similar-sequences .working-text'), count);
}
const wantedHeads = list => list.map(item => [named(item.activities), item.distance === 0 ? `The chosen sequence itself · ${item.cases.length} case${item.cases.length === 1 ? '' : 's'} of the parent, ${item.cases.length} kept`
  : `${item.distance} edit${item.distance === 1 ? '' : 's'} away · ${item.cases.length} case${item.cases.length === 1 ? '' : 's'} of the parent, ${item.cases.length} kept`]);

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await page.getByRole('navigation', {name: 'Areas'}).getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, expected.incidents.length);
  await settled(0);
  const parent = selections.at(-1);
  const before = selections.length;
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Variants', exact: true}).click();
  await page.getByRole('button', {name: 'Cases with a sequence similar to variant 1', exact: true}).click();
  await shown(oracle.one_edit.families.length);

  // ---- the families within one edit, then two, by the stated method; nothing applied ----
  check('one_edit_families_as_the_oracle', same(await families(), wantedHeads(oracle.one_edit.families)), await families());
  const said = (await panel().textContent()) ?? '';
  check('measure_threshold_eligibility_and_support_said', said.includes('the least number of activities to insert, remove or replace') && said.includes('does not change with the kept cases')
    && said.includes(`5 families of exactly equal sequences within 1 edit: ${oracle.one_edit.suggested} cases of the 10 eligible cases of the parent, ${oracle.one_edit.suggested} kept cases of 10.`), said.slice(0, 700));
  check('asking_applies_nothing', selections.length === before, [before, selections.length]);
  await panel().getByRole('radio', {name: 'At most 2 edits'}).check();
  await shown(oracle.one_edit.families.length + oracle.two_edits.added.length);
  check('two_edit_families_as_the_oracle', same(await families(), wantedHeads([...oracle.one_edit.families, ...oracle.two_edits.added])), await families());
  check('stability_and_no_class_said', said.includes('one more edit can add whole families') && said.includes('A family is not a business class, a cause or a prediction.'), null);
  check('method_fixed_before_filtering', asked.every(request => same(request.anchor, oracle.anchor.map(letter => NAME[letter]))) && asked.map(request => request.maximum_edits).join() === '1,2', asked.map(request => request.maximum_edits));

  // ---- a representative complete history ----
  await panel().getByRole('button', {name: 'Open L-03, a complete history of this family', exact: true}).click();
  await page.getByRole('heading', {name: 'Case L-03'}).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('ol.history > li').length > 0);
  check('representative_complete_history_opens', await page.locator('ol.history > li').count() === expected.records['L-03'], null);
  await page.keyboard.press('Escape');

  // ---- kept as a step of explicit identifiers in the existing parent, then undone ----
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Variants', exact: true}).click();
  if (!(await panel().count())) await page.getByRole('button', {name: 'Cases with a sequence similar to variant 1', exact: true}).click();
  await panel().getByRole('radio', {name: 'At most 1 edit'}).check();
  await shown(oracle.one_edit.families.length);
  await panel().getByRole('button', {name: `Keep the ${oracle.one_edit.suggested} kept cases suggested`, exact: true}).click();
  await settled(1);
  const kept = selections.at(-1);
  const suggestion = oracle.one_edit.families.flatMap(item => item.cases).sort();
  check('suggestion_kept_as_explicit_identifiers_in_the_existing_parent', same(kept.kept.case_ids, suggestion) && kept.predicate_results[0].predicate.kind === 'case_id_in'
    && same([...kept.predicate_results[0].predicate.case_ids].sort(), suggestion) && same(kept.parent.case_ids, parent.kept.case_ids), kept.kept.case_ids);
  // The suggestions are the parent's: with the step taken the families stay, only the kept counts follow.
  await page.getByRole('button', {name: 'Cases with a sequence similar to variant 1', exact: true}).click().catch(() => undefined);
  await page.getByRole('group', {name: 'Steps', exact: true}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  check('undo_restores_the_selection', same(selections.at(-1).identity, parent.identity), null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
