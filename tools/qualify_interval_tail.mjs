// The built browser through one supported interval (#10) of the invented tests/fixtures/intervals file: the interval
// is named with its pairing, clock and cutoff; the parent's bins and the incidents without an interval by reason are
// shown; a measured zero differs from a missing endpoint. A tail is taken from a bin and typed in the form with the same
// inclusive step; it is previewed, cancelled, previewed and applied; an incident of the tail is opened with both
// endpoint records and the focus returns to it; Undo restores the exact parent; the strict tail keeps exactly four hours
// out. Every expectation comes from tests/fixtures/intervals/expected.json.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 768}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [], previewed = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (new URL(request.url()).pathname !== '/api/investigations/select-cases') return;
  const body = JSON.parse(request.postData() ?? '{}');
  if (body.request_id?.startsWith('preview-')) previewed.push(body.predicates.at(-1));
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
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
const panel = () => page.locator('section.interval-panel');
const binCounts = async column => (await panel().getByRole('table', {name: 'Measured intervals in bins the parent fixes'}).locator('tbody tr').evaluateAll((rows, index) => rows.map(row => Number(row.children[index].textContent)), column));

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await settled(0);
  const parent = selections.at(-1);
  const asked = selections.length;
  await page.getByRole('button', {name: 'Filters and views'}).click();
  await page.getByRole('group', {name: 'Side panel'}).getByRole('button', {name: 'Interval', exact: true}).click();
  await panel().getByLabel('Start activity').selectOption(expected.interval.start_activity);
  await panel().getByLabel('Response activity').selectOption(expected.interval.response_activity);
  await panel().getByRole('button', {name: 'Measure the interval', exact: true}).click();
  await panel().getByRole('table', {name: 'Measured intervals in bins the parent fixes'}).waitFor();
  const text = (await panel().textContent()) ?? '';
  check('interval_pairing_clock_and_cutoff_named', text.includes(`From the first “${expected.interval.start_activity}” to the first “${expected.interval.response_activity}” at or after it, in hours, as elapsed time in UTC.`)
    && text.includes('Export taken at') && text.includes(expected.interval.policy) && text.includes('Other pairings, such as the last start, the final response or cycles, are not offered'), null);
  // The browser's bins are coarser than the oracle's: compare the parent's counts that the oracle's edges also bound.
  const parentBins = await binCounts(2);
  const measuredHours = Object.values(expected.hours);
  const edges = [0, 1, 2, 4, 8, 24, 72, 168, 720];
  const wanted = edges.map((start, index) => measuredHours.filter(hours => hours >= start && (index + 1 >= edges.length || hours < edges[index + 1])).length);
  check('parent_bins_match_the_oracle', same(parentBins, wanted), [parentBins, wanted]);
  const reasons = await panel().getByRole('table', {name: 'Incidents without this interval, by reason'}).locator('tbody tr').evaluateAll(rows => rows.map(row => Number(row.children[2].textContent)));
  check('missing_reasons_counted', same(reasons, [expected.unavailable.order_unknown, expected.unavailable.missing_start, expected.unavailable.missing_response]), reasons);
  const listed = await panel().getByRole('list', {name: 'Intervals of these incidents, longest first'}).getByRole('listitem').allTextContents();
  const witness = expected.witness;
  check('witness_names_both_endpoint_rows', listed.some(item => item.startsWith(`${witness.case}: from the record at source position ${witness.start_position} to the record at source position ${witness.response_position}, ${expected.hours[witness.case]} h.`)), listed);
  check('measured_zero_differs_from_missing', listed.some(item => item.startsWith('I-ZERO: from the record')) && listed.some(item => item.startsWith('I-NORESP: no interval')), null);

  // Brush and form give the same inclusive step; it is previewed, cancelled, previewed again and applied.
  const inclusive = expected.inclusive_4;
  await panel().getByRole('button', {name: `Keep from ${inclusive.hours} h up`, exact: true}).click();
  const pending = panel().getByRole('group', {name: 'Tail not yet applied'});
  await pending.getByText(/^Preview:/).waitFor();
  const fromBin = previewed.at(-1);
  await pending.getByRole('button', {name: 'Cancel', exact: true}).click();
  check('cancel_takes_nothing', selections.length === asked, selections.length);
  await panel().getByLabel('Threshold in hours').fill(String(inclusive.hours));
  await panel().getByLabel(/^at least the threshold/).check();
  await panel().getByRole('button', {name: 'Preview this tail', exact: true}).click();
  await pending.getByText(/^Preview:/).waitFor();
  check('brush_and_form_give_the_same_step', same(previewed.at(-1), fromBin) && fromBin.operator === 'ge' && fromBin.hours === inclusive.hours, [fromBin, previewed.at(-1)]);
  check('preview_names_the_tail', ((await pending.textContent()) ?? '').includes(`would keep ${inclusive.kept.length} incidents`), await pending.textContent());
  await pending.getByRole('button', {name: 'Apply', exact: true}).click();
  await settled(1);
  const applied = selections.at(-1);
  check('inclusive_tail_matches_the_oracle', same(applied.kept.case_ids, inclusive.kept) && same(applied.removed.case_ids, inclusive.removed) && same(applied.unevaluable.case_ids, inclusive.unevaluable), applied.kept);
  // The parent fixes the bins: they stay; the kept counts follow the tail.
  await panel().getByRole('table', {name: 'Measured intervals in bins the parent fixes'}).waitFor();
  await page.waitForFunction(n => [...document.querySelectorAll('section.interval-panel table[aria-label="Measured intervals in bins the parent fixes"] tbody tr')].reduce((sum, row) => sum + Number(row.children[1].textContent), 0) === n, inclusive.kept.length);
  check('bins_stay_those_of_the_parent', same(await binCounts(2), wanted), null);
  // An incident of the tail opens with both endpoints among all its records; the focus returns to it.
  const tailCase = inclusive.kept[0];
  await panel().getByRole('button', {name: `Open ${tailCase}`, exact: true}).click();
  const records = page.getByRole('list', {name: `Records of incident ${tailCase} in the declared order`});
  await records.waitFor();
  const items = await records.getByRole('listitem').allTextContents();
  const statusLine = (await panel().locator('.interval-witness').textContent()) ?? '';
  const positions = [...statusLine.matchAll(/source position (\d+)/g)].map(match => match[1]);
  check('endpoint_rows_found_among_all_records', positions.length === 2 && positions.every(position => items.some(item => item.includes(`source position ${position}`))), [positions, items]);
  await page.getByRole('button', {name: 'Return to incidents', exact: true}).focus();
  await page.keyboard.press('Enter');
  // Back from the incident, the focus is on the button the incident was opened with.
  await page.waitForFunction(id => document.activeElement?.getAttribute('data-open-case') === id, tailCase);
  check('return_restores_the_focus', true);
  // Undo: the exact parent. Strict: exactly four hours is left out.
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  check('undo_restores_the_exact_parent', same(selections.at(-1).identity, parent.identity), null);
  const strict = expected.strict_4;
  await panel().getByLabel('Threshold in hours').fill(String(strict.hours));
  await panel().getByLabel(/^more than the threshold/).check();
  await panel().getByRole('button', {name: 'Preview this tail', exact: true}).click();
  await pending.getByRole('button', {name: 'Apply', exact: true}).click();
  await settled(1);
  const strictAnswer = selections.at(-1);
  check('strict_tail_matches_the_oracle', same(strictAnswer.kept.case_ids, strict.kept) && same(strictAnswer.removed.case_ids, strict.removed) && same(strictAnswer.unevaluable.case_ids, strict.unevaluable), strictAnswer.kept);
  const chip = (await page.getByRole('list', {name: 'Steps of the selection'}).locator('.chip-wording').first().textContent()) ?? '';
  check('chip_names_the_strict_tail', chip.includes('is more than 4 hours'), chip);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
