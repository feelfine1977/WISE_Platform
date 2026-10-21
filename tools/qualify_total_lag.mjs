// The built browser through the ranking of the paths by the time spent on them (#88) over the invented
// tests/fixtures/total-lag file: the list of paths opens on the total time, the largest first, as the hand-written
// expected.json orders them, its head naming the unit; a line says the share of the time on all paths the first five rows
// carry; the rare long path comes first in the order by median lag.
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
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const list = () => page.getByRole('table', {name: 'Paths of the kept cases'});
const rows = () => list().locator('tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(cell => cell.textContent)));
const day = hours => new Intl.NumberFormat('en', {minimumFractionDigits: 1, maximumFractionDigits: 1}).format(hours / 24);

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await page.getByRole('navigation', {name: 'Areas'}).getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Paths', exact: true}).click();
  await list().waitFor();

  const head = list().getByRole('columnheader', {name: 'Total time (days, all passages)'});
  check('head_names_the_unit_and_opens_the_order', await head.getAttribute('aria-sort') === 'descending', await head.getAttribute('aria-sort'));
  const opened = (await rows()).filter(cells => !['Start', 'End'].includes(cells[0]) && !['Start', 'End'].includes(cells[1]));
  check('ordered_by_total_time_largest_first', same(opened.map(cells => `${cells[0]}>${cells[1]}`), expected.order_by_total), opened.map(cells => cells.slice(0, 2)));
  check('total_time_in_days', same(opened.map(cells => cells[5]), expected.order_by_total.map(name => day(expected.totals_hours[name]))), opened.map(cells => cells[5]));
  const share = new Intl.NumberFormat('en', {style: 'percent', maximumFractionDigits: 1}).format(expected.first_five_share);
  const line = await page.locator('.path-leading').textContent();
  check('first_five_rows_share_said', line.replace(/\s+/g, ' ').trim() === `The first 5 rows in this order carry ${share} of the time spent on all paths (${day(expected.all_paths_hours)} days over all passages).`, line);
  await list().getByRole('button', {name: 'Median lag of the passages (h): sort the list'}).click();
  const byMedian = await rows();
  check('rare_long_path_first_by_median_lag', `${byMedian[0][0]}>${byMedian[0][1]}` === expected.order_by_median_first, byMedian[0]);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
