// The built browser through the list of kept incidents by time (#58) of the invented tests/fixtures/span-gap file: each
// order of the hand-written expected.json either way round, equal values by number and unavailable values last; what is
// said of the incident in focus (first and last records, span, longest gap with its activities, offset, share and the
// chosen context columns' values) and its two records opened; the longest gap marked on the axis of the records; and the
// search by number, which narrows only the rows while the counts and the distribution stay those of every kept incident.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const incidents = expected.orders['observed_span_hours descending'].length;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 768}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], lists = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  if (new URL(response.url()).pathname !== '/api/investigations/case-list' || !response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (answer) lists.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areas = page.getByRole('navigation', {name: 'Areas'});
const view = name => page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name, exact: true});
const order = name => page.getByRole('group', {name: 'Order of the incidents'}).getByRole('button', {name, exact: true});
const table = () => page.locator('.incident-table table.window-table');
const listed = () => table().locator('tbody tr th button.row-open').allTextContents();
const focus = () => page.locator('section.incident-focus');
const said = sentence => focus().getByText(sentence, {exact: true});
/** Waits until the list shows exactly the incidents given, in their order. */
async function shows(ids) {
  await page.waitForFunction(ids => JSON.stringify([...document.querySelectorAll('.incident-table table.window-table tbody tr th button.row-open')].map(b => b.textContent)) === JSON.stringify(ids), ids);
  return listed();
}
const ORDERS = [
  ['Longest span first', 'observed_span_hours', 'descending', 'ascending'],
  ['Longest gap first', 'maximum_adjacent_raw_gap_hours', 'descending', 'ascending'],
  ['Most records first', 'record_count', 'descending', null],
  ['Earliest first record', 'first_recorded_time', 'ascending', 'descending'],
];

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, incidents);
  await view('Incidents').click();

  // Every order of the oracle, either way round: equal values by number, unavailable values last.
  for (const [label, field, first, second] of ORDERS) {
    await order(label).click();
    const wanted = expected.orders[`${field} ${first}`];
    check(`${field}_${first}`, same(await shows(wanted), wanted) && same(lists.at(-1).query.sort, {field, direction: first}), lists.at(-1).query);
    if (second === null) continue;
    await page.getByRole('button', {name: 'Reverse', exact: true}).click();
    const back = expected.orders[`${field} ${second}`];
    check(`${field}_${second}`, same(await shows(back), back) && same(lists.at(-1).query.sort, {field, direction: second}), lists.at(-1).query);
    await page.getByRole('button', {name: 'Reverse', exact: true}).click();
    await shows(wanted);
  }
  const unknown = expected.unknown_order[0];
  const unknownRow = table().locator('tbody tr').filter({has: page.locator('th', {hasText: unknown})});
  check('unavailable_values_are_dashes', same((await unknownRow.locator('td').allTextContents()).slice(4, 8), ['–', '–', '–', '–']), await unknownRow.locator('td').allTextContents());

  // The longest span first: what is said of the first incident, and its longest gap marked on the axis of the records.
  await order('Longest span first').click();
  await shows(expected.orders['observed_span_hours descending']);
  const longest = expected.witnesses['S-LONG'];
  await said(`Longest gap 2 d, from “${longest.from_activity}” to “${longest.to_activity}”, beginning 12 h after the first record; 67% of the span.`).waitFor();
  check('gap_said_with_activities_offset_and_share', true);
  const marks = table().locator('tbody tr').first().getByRole('img');
  await marks.waitFor();
  check('longest_gap_marked_on_the_axis', (await marks.getAttribute('aria-label')).endsWith('; the longest gap, 2 d, marked from 12 h') && await marks.locator('.record-marks-gap').count() === 1,
    await marks.getAttribute('aria-label'));
  check('axis_is_the_longest_span_listed', await table().locator('thead th').last().textContent() === 'Records over time, 0 to 3 d', await table().locator('thead th').last().textContent());

  // The incident with a record without activity label: first and last records, the gap from that record, the chosen context.
  await table().locator('tbody tr th button', {hasText: /^S-UNLAB$/}).click();
  const unlab = expected.first_last['S-UNLAB'];
  await said(`First record ${unlab.first.replace('T', ' ').replace('Z', ' UTC')}, “${unlab.first_activity}”; last record ${unlab.last.replace('T', ' ').replace('Z', ' UTC')}, “${unlab.last_activity}”.`).waitFor();
  await said('Longest gap 6 h, from a record without activity label to “Resolved”, beginning 1 h after the first record; 86% of the span.').waitFor();
  check('unlabelled_record_bounds_the_gap', true);
  const context = await focus().getByRole('table').locator('tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(cell => cell.textContent)));
  const gapContext = expected.gap_context['S-UNLAB'];
  const wantedContext = expected.context_names.map((name, index) => [name, gapContext.from[index] ?? 'not recorded', gapContext.to[index] ?? 'not recorded']);
  check('context_from_chosen_columns_only', same(context, wantedContext), context);
  // On request, a picture of the list with the incident in focus, for a reader to look at; it holds only the invented file.
  if (process.env.WISE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.WISE_SCREENSHOT_DIR}/issue58-span-gap-list.png`, fullPage: true});
  await focus().getByRole('button', {name: 'Show the two records of the gap', exact: true}).click();
  await page.waitForFunction(() => document.querySelectorAll('.imported-inspector [data-contributing]').length === 2);
  const marked = await page.locator('.imported-inspector [data-contributing]').evaluateAll(items => items.map(item => [...item.parentElement.children].indexOf(item) + 1));
  const witness = expected.witnesses['S-UNLAB'];
  check('two_records_of_the_gap_opened', same(marked, [witness.from_position, witness.to_position]), marked);

  // One record spans zero and has no gap; tied times are zero gaps.
  await table().locator('tbody tr th button', {hasText: /^S-ONE$/}).click();
  await said('Recorded span 0 min: one record spans zero.').waitFor();
  await said('No longest gap: one record has no gap.').waitFor();
  check('one_record_zero_span_no_gap', true);
  await table().locator('tbody tr th button', {hasText: /^S-ALLTIE$/}).click();
  await said('Longest gap 0 min, from “Opened” to “Resolved”, beginning 0 min after the first record; no share: the span is zero.').waitFor();
  await said('One group of records shares a time; the gaps within it are zero.').waitFor();
  check('tied_times_zero_gap_without_share', true);

  // The search narrows only the rows shown, in the same order; the counts and the distribution are unchanged.
  const whole = lists.at(-1);
  await page.getByRole('searchbox', {name: 'Incident number contains'}).fill(expected.search.text);
  await page.getByRole('button', {name: 'Find', exact: true}).click();
  check('search_in_the_same_order', same(await shows(expected.search.span_descending), expected.search.span_descending), await listed());
  const found = lists.at(-1);
  check('search_keeps_counts_and_distribution', found.query.search_text === expected.search.text && found.population_case_count === whole.population_case_count
    && same(found.distribution, whole.distribution) && same(found.identity, whole.identity), [found.population_case_count, whole.population_case_count]);
  check('search_said', (await page.getByRole('status').filter({hasText: 'kept incidents of'}).textContent()).startsWith(`2 kept incidents of ${incidents} have “${expected.search.text}” in their numbers.`), null);
  await page.getByRole('button', {name: 'Show every kept incident', exact: true}).click();
  check('search_cleared', same(await shows(expected.orders['observed_span_hours descending']), expected.orders['observed_span_hours descending']), null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
