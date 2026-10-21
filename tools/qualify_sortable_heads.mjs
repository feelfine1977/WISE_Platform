// The built browser through the heads of the incident list (#91) over the invented tests/fixtures/span-gap file: a click
// on the head of Records, Span, Longest gap or First record orders the list by it as the hand-written oracle does, a
// second click reverses it, and the head says the direction for assistive technology; the order is said in words, with
// equal values by number and incidents without the value last.
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
const table = () => page.locator('.incident-table table.window-table');
const head = name => table().getByRole('columnheader', {name, exact: true});
async function shows(ids) {
  await page.waitForFunction(ids => JSON.stringify([...document.querySelectorAll('.incident-table table.window-table tbody tr th button.row-open')].map(b => b.textContent)) === JSON.stringify(ids), ids);
  return table().locator('tbody tr th button.row-open').allTextContents();
}
const HEADS = [
  ['Records', 'record_count', 'descending', 'ascending', 'number of records', ['the most first', 'the fewest first']],
  ['Span', 'observed_span_hours', 'descending', 'ascending', 'recorded span', ['the longest first', 'the shortest first']],
  ['Longest gap', 'maximum_adjacent_raw_gap_hours', 'descending', 'ascending', 'longest gap between two records', ['the longest first', 'the shortest first']],
  ['First record', 'first_recorded_time', 'ascending', 'descending', 'time of the first record', ['the earliest first', 'the latest first']],
];

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, incidents);
  await view('Cases').click();

  // By number, the head of Records already orders the list, by the local service.
  check('by_number_records_head_sorts', await head('Records').getByRole('button', {name: 'Records: sort the list'}).count() === 1 && await head('Records').getAttribute('aria-sort') === null, null);
  for (const [label, field, first, second, measure, said] of HEADS) {
    for (const [direction, words] of [[first, said[0]], [second, said[1]]]) {
      await head(label).getByRole('button', {name: `${label}: sort the list`}).click();
      const wanted = expected.orders[`${field} ${direction}`];
      const order = await shows(wanted);
      check(`${field}_${direction}_ordered_as_the_oracle`, same(order, wanted) && same(lists.at(-1).query.sort, {field, direction}), [order, lists.at(-1).query.sort]);
      check(`${field}_${direction}_head_says_the_direction`, await head(label).getAttribute('aria-sort') === direction
        && (await Promise.all(HEADS.filter(([other]) => other !== label).map(([other]) => head(other).getAttribute('aria-sort')))).every(value => value === null), null);
      check(`${field}_${direction}_said_with_ties_and_unavailable`, await page.getByText(`By ${measure}, ${words}; equal values in the order of their numbers, and cases without a value last.`, {exact: true}).count() === 1, null);
    }
  }
  // The order of the buttons above the list follows the heads.
  check('order_buttons_follow_the_heads', await page.getByRole('group', {name: 'Order of the cases'}).getByRole('button', {name: 'Earliest first record', exact: true}).getAttribute('aria-pressed') === 'true', null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
