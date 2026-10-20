// The built browser through numbers in a context column (#85) over the invented tests/fixtures/numeric-context file.
// Phase "declare": the file is added in the Data area, Confidence and Amount (unit EUR) are declared numbers, the
// summary says so and the reading is confirmed; in the Filters the range of a number shows the parent's range, its bins
// and what has no number; every range of the hand-written expected.json is previewed, taken as one step that keeps the
// oracle's incidents, and undone exactly; a range chosen on the chart takes the parent's exact edges. Phase "reopen",
// after an actual restart: the reading opens again with its declaration.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {addStep} from './add_step.mjs';

const [base, output, playwright, chrome, configPath, phase] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const incidents = 7;
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areas = page.getByRole('navigation', {name: 'Areas'});
const ISO = 'Year-Month-Day, ISO 8601';
let preparationId = config.preparation_id ?? null;
const PROJECTIONS = {first_record: 'the first record', latest_record: 'the latest record with a value', any_record: 'any record'};

async function press(locator, key = 'Enter') { await locator.focus(); await page.keyboard.press(key); }
async function role(label, column) {
  const select = page.getByLabel(label, {exact: true});
  const value = await select.evaluate((element, name) => [...element.options].find(option => option.text.startsWith(`${name} — `))?.value, column);
  assert.ok(value !== undefined, `${label}: no option for ${column}`);
  await select.selectOption(value);
}
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
// The range of a number, from the one entry of every step (#94).
const control = () => page.locator('.number-range');
async function openNumbers() {
  if (!(await control().isVisible().catch(() => false))) await addStep(page, 'A range of a number in a context column');
}
const said = () => control().locator('.number-range-read').textContent();
async function readAt(column, projection) {
  await control().getByLabel(/^Column/).selectOption(String(column));
  await control().getByLabel(/^Read at/).selectOption(projection);
  await page.waitForFunction(name => document.querySelector(`.number-range [aria-label="${name}"]`) !== null || /No incident of the parent/.test(document.querySelector('.number-range .number-range-read')?.textContent ?? ''),
    `Incidents by ${column === 5 ? 'Confidence' : 'Amount'} at ${PROJECTIONS[projection]}`);
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0 || !!document.querySelector('[aria-label="Add an event-history CSV"]'));
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  if (phase === 'declare') {
    await page.getByLabel('Add an event-history CSV').setInputFiles(config.file);
    await page.getByLabel('Incident id', {exact: true}).waitFor();
    await role('Incident id', 'Ticket');
    await role('Activity', 'Status');
    await role('Time', 'At');
    await role('Sequence number (optional)', 'Seq');
    const context = page.getByRole('group', {name: 'Context attributes (optional)'});
    for (const box of await context.getByRole('checkbox').all()) {
      const name = ((await box.evaluate(element => element.closest('label')?.textContent ?? '')) || '').split(' — ')[0].trim();
      if (['Desk', 'Confidence', 'Amount'].includes(name) && !(await box.isChecked())) await box.check();
    }
    // The declaration: two of the context columns are numbers, Amount with its unit; Desk stays text.
    const numbers = page.getByRole('group', {name: 'Read as numbers (optional)'});
    await numbers.getByRole('checkbox', {name: 'Confidence is a number'}).check();
    await numbers.getByRole('checkbox', {name: 'Amount is a number'}).check();
    await numbers.getByLabel('Unit of Amount (optional)').fill('EUR');
    check('declaration_offered_for_context_columns_only', await numbers.getByRole('checkbox').count() === 3
      && (await numbers.textContent()).includes('anything else stays as written and is counted as “not a number”, never as zero'), await numbers.textContent());
    await page.getByRole('radio', {name: new RegExp(`^${ISO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)}).check();
    await page.getByRole('radio', {name: 'Offsets written in the values, for example Z or +02:00'}).check();
    await page.getByRole('status').filter({hasText: /^Proposed from the data:/}).waitFor();
    const use = page.getByRole('button', {name: 'Use the proposal', exact: true});
    if (await use.count()) await use.click();
    await press(page.getByRole('button', {name: 'Read the source with these choices', exact: true}));
    const summary = page.getByRole('region', {name: 'What WISE understood'});
    await summary.waitFor();
    const text = (await summary.textContent()) ?? '';
    check('summary_says_the_declaration', /Read as numbers.*Confidence.*Amount.*\(EUR\)/.test(text), text.slice(0, 600));
    const issues = page.getByRole('checkbox', {name: 'I have read the rows with issues; keep them as described above.'});
    if (await issues.count()) await press(issues, 'Space');
    const [prepared] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/preparations' && r.request().method() === 'POST'),
      press(page.getByRole('button', {name: 'Confirm and prepare', exact: true}))]);
    const preparation = (await prepared.json()).preparation;
    preparationId = preparation?.preparation_id ?? null;
    check('declaration_in_the_preparation', same(preparation?.mapping?.numeric_context_columns, [{column_index: 5, unit: null}, {column_index: 6, unit: 'EUR'}]), preparation?.mapping);
    await page.getByRole('status').filter({hasText: 'Ready: the source is read with these choices'}).waitFor();
    await press(page.getByRole('button', {name: 'Open incidents', exact: true}));
    await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, incidents);
    await settled(0);
    const parent = selections.at(-1);

    // The range of a number: the parent's range, its bins, what has no number, and the records that are not numbers.
    await openNumbers();
    await readAt(5, 'first_record');
    const confidence = expected.confidence.first_record_bins_4;
    const first = await said();
    check('parent_range_and_measured_said', first.includes(`Range in the parent: ${confidence.parent_range[0]} to ${confidence.parent_range[1]}; 4 kept incidents of ${incidents} have a number.`), first);
    check('without_a_number_by_reason', first.includes('Without a number here: 1 kept incident (order not known), 1 kept incident (no value), 1 kept incident (not a number)'), first);
    check('records_not_numbers_counted_never_zero', first.includes(`${expected.confidence.records.not_a_number_record_count} records of the parent hold text that is not a number in this column; it stays as written and is never read as zero.`), first);
    check('equality_at_the_bounds_said', (await control().textContent()).includes('The lower bound is included and the upper bound is not'), null);

    // Every range of the oracle, typed, kept or removed, previewed, taken as one step and undone exactly.
    for (const range of expected.ranges) {
      await openNumbers();
      await readAt(range.column, range.projection);
      await control().getByLabel(/^From, included/).fill(range.minimum === null ? '' : String(range.minimum).replace('.', ','));
      await control().getByLabel(/^Up to, not included/).fill(range.maximum === null ? '' : String(range.maximum));
      await control().getByRole('button', {name: range.negate ? 'Remove this range of numbers' : 'Keep this range of numbers', exact: true}).click();
      // Applied at once from "+ Add step" (#94).
      await settled(1);
      const taken = selections.at(-1);
      check(`${range.name}_kept_as_the_oracle`, same(taken.kept.case_ids, range.kept) && same(taken.unevaluable.case_ids, range.unevaluable)
        && same(taken.predicate_results[0].predicate, {kind: 'context_number_in_range', column_index: range.column, projection: range.projection, minimum: range.minimum, maximum: range.maximum, negate: range.negate}),
        [taken.kept.case_ids, taken.unevaluable.case_ids, taken.predicate_results[0].predicate]);
      const chip = await page.getByRole('list', {name: 'Steps of the selection'}).locator('li').first().textContent();
      check(`${range.name}_step_says_its_unevaluable`, chip.includes(`Not evaluable${range.unevaluable.length} incident${range.unevaluable.length === 1 ? '' : 's'}`), chip);
      await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
      await settled(0);
      check(`${range.name}_undone_exactly`, same(selections.at(-1).identity, parent.identity), null);
    }

    // A range chosen on the chart: the first bin, with the exact edges the parent fixed.
    await openNumbers();
    await readAt(5, 'first_record');
    const chart = control().getByRole('group', {name: 'Incidents by Confidence at the first record'});
    await chart.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await settled(1);
    const fromChart = selections.at(-1);
    const predicate = fromChart.predicate_results[0].predicate;
    // The screen asks for ten bins: the first spans a tenth of the parent's range, 0.75 to 0.765.
    const firstEdge = confidence.parent_range[0] + (confidence.parent_range[1] - confidence.parent_range[0]) / 10;
    check('chart_takes_the_parents_edges', predicate.minimum === confidence.parent_range[0] && Math.abs(predicate.maximum - firstEdge) < 1e-12 && same(fromChart.kept.case_ids, ['N-6']), predicate);
    await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
    await settled(0);

    // The unit of a column, its range with a sign, and its cells that are not numbers.
    await openNumbers();
    await readAt(6, 'first_record');
    const amount = await said();
    check('unit_and_signed_range', amount.includes('Range in the parent: -5 EUR to 250.5 EUR') && await control().getByLabel('From, included (EUR)').count() === 1
      && amount.includes(`${expected.amount.records.not_a_number_record_count} records of the parent hold text that is not a number`), amount);
  } else {
    // After an actual restart the reading opens again, with its declaration.
    await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${preparationId}$`)}).click();
    try {
      await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, incidents, {timeout: 20000});
    } catch (error) {
      if (process.env.WISE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.WISE_SCREENSHOT_DIR}/issue85-reopen-failed.png`});
      throw error;
    }
    await openNumbers();
    const options = await control().getByLabel(/^Column/).locator('option').allTextContents();
    check('declaration_reopened_after_restart', same(options, ['Confidence', 'Amount (EUR)']), options);
    await readAt(5, 'latest_record');
    check('numbers_read_after_restart', (await said()).includes('Range in the parent: 0.6 to 0.95'), await said());
  }
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks, preparation_id: preparationId}));
} finally {
  await browser.close();
}
