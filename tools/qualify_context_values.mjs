// The built browser keeping incidents by values of a context column (#63) in the invented explorer core file.
// Review phase:
// - values are joined by OR, at any raw record or at the first one, with suggestions and exact entry;
// - a missing value is kept apart from the text Unknown; a repeated value is refused whole;
// - an incident holding two of the values counts once;
// - another condition combines by AND; Undo restores the earlier identity; the investigation is saved.
// Reopen phase, after an actual restart: the same steps and identity come back.
// Every expectation comes from tests/fixtures/selection-journey/context-values.json.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {addStep} from './add_step.mjs';

const [base, output, playwright, chrome, configPath, phase] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
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
const areas = page.getByRole('navigation', {name: 'Areas'});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const last = () => selections.at(-1);
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n, steps);
}
async function contextFilter({values, missing = false, where = 'any'}) {
  // From the one entry of every step (#94); a refused entry leaves its form open.
  const section = (await page.getByRole('group', {name: 'Add a step'}).getByLabel('Exact context values').isVisible().catch(() => false))
    ? page.getByRole('group', {name: 'Add a step'}) : await addStep(page, 'Context values');
  await section.getByLabel('Where to look').selectOption(where);
  await section.getByLabel('Exact context values').fill(values.join('\n'));
  const box = section.getByLabel('Not recorded (distinct from the text “Unknown”)');
  if ((await box.isChecked()) !== missing) await box.setChecked(missing);
  await section.getByRole('button', {name: 'Keep by context', exact: true}).click();
}
async function take(steps) {
  // Applied at once from "+ Add step" (#94).
  await settled(steps);
  return last();
}
const undo = async steps => { await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click(); await settled(steps); };
const partition = (answer, oracle) => same(answer.kept.case_ids, oracle.kept) && (!oracle.removed || same(answer.removed.case_ids, oracle.removed)) && (!oracle.unevaluable || same(answer.unevaluable.case_ids, oracle.unevaluable));

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  if (phase === 'review') {
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
    await settled(0);
    const section = await addStep(page, 'Context values');
    // The column, its anchoring and the suggestions from the first records.
    const columnLabel = await section.getByLabel('Context column').evaluate(select => select.selectedOptions[0].text);
    const suggestions = await section.getByRole('group', {name: 'Suggestions from first records'}).locator('label').allTextContents();
    check('column_and_suggestions_offered', columnLabel === expected.column && suggestions.some(text => text.startsWith('"West"')) && suggestions.some(text => text.startsWith('Not recorded')), [columnLabel, suggestions]);
    // A repeated value is refused whole.
    const asked = selections.length;
    await contextFilter({values: expected.duplicate_entry});
    check('repeated_value_refused', ((await page.getByRole('alert').textContent()) ?? '').startsWith('A context value appears more than once') && selections.length === asked, null);
    // Any raw record: East.
    await contextFilter({values: expected.any_east.values});
    const east = await take(1);
    check('any_record_value_matches_the_oracle', partition(east, expected.any_east), east.kept);
    // Two values held by one incident (G: North, then East) keep it once.
    await undo(0);
    await contextFilter({values: expected.any_north_or_east.values});
    const either = await take(1);
    check('overlapping_values_count_an_incident_once', partition(either, expected.any_north_or_east), either.kept);
    await undo(0);
    // Missing apart from the text Unknown, at any record.
    await contextFilter({values: expected.any_missing_or_unknown.values, missing: true});
    const missing = await take(1);
    check('missing_and_unknown_are_distinct_values', partition(missing, expected.any_missing_or_unknown), missing.kept);
    await undo(0);
    // At the first raw record: a missing first value is not replaced by a later one (H counts West, C stays out).
    await contextFilter({values: expected.first_west_or_east.values, where: 'opening'});
    const first = await take(1);
    check('first_record_values_match_the_oracle', partition(first, expected.first_west_or_east), first.kept);
    await undo(0);
    // AND with another condition: any East, and a gap of at least an hour.
    await contextFilter({values: expected.any_east.values});
    const east2 = await take(1);
    check('same_definition_same_identity', same(east2.identity, east.identity), null);
    const time = await addStep(page, 'Recorded time');
    await time.getByLabel('Measure').selectOption('max_raw_gap_at_least');
    await time.getByLabel('At least this many hours').fill('1');
    await time.getByRole('button', {name: 'Keep by recorded time', exact: true}).click();
    const both = await take(2);
    check('conditions_combine_by_and', partition(both, expected.any_east_and_gap_1h), both.kept);
    const chips = await page.getByRole('list', {name: 'Steps of the selection'}).locator('.chip-wording').allTextContents();
    check('chips_name_values_and_column', chips.length === 2 && chips[0].includes('“East”') && chips[0].includes(`“${expected.column}”`), chips);
    await undo(1);
    check('undo_restores_the_earlier_identity', same(last().identity, east.identity), null);
    await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Redo', exact: true}).click();
    await settled(2);
    await page.getByRole('button', {name: 'Save', exact: true}).first().click();
    const form = page.locator('#saved-form');
    await form.getByLabel('Name').fill(config.saved_name);
    const [saved] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/save'), form.getByRole('button', {name: 'Save', exact: true}).click()]);
    check('investigation_saved', saved.status() === 200, saved.status());
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks, identity: last().identity, chips}));
  } else {
    await areas.getByRole('button', {name: 'Saved', exact: true}).click();
    await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/reopen'),
      page.getByRole('button', {name: `Reopen ${config.saved_name}`, exact: true}).click()]);
    await page.getByRole('list', {name: 'Steps of the selection'}).waitFor();
    await settled(2);
    check('reopened_identity_matches', same(last().identity, config.identity), null);
    check('reopened_membership_matches_the_oracle', partition(last(), expected.any_east_and_gap_1h), last().kept);
    const chips = await page.getByRole('list', {name: 'Steps of the selection'}).locator('.chip-wording').allTextContents();
    check('reopened_chips_match', same(chips, config.chips), chips);
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks}));
  }
} finally {
  await browser.close();
}
