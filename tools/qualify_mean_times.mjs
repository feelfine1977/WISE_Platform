// The built browser through the means of the times between records (#74) over the invented tests/fixtures/mean-times
// file: each activity selected on the map shows the median and the mean from the previous and to the next labelled record
// with the passages they rest on, as the hand-written expected.json says; each path into and out of it its median and mean
// lag; an activity without a passage says why. Durations are matched in the map library's one format.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 900}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const areas = page.getByRole('navigation', {name: 'Areas'});
const nodeId = label => `activity.v1:sha256:${createHash('sha256').update(label, 'utf8').digest('hex')}`;
// The map library's own duration format, the one the screen writes every time in.
const {formatHours} = await import(new URL('../node_modules/wise-flow/dist/core/format.js', import.meta.url).href);
const hours = value => formatHours(value, 'en');
async function select(label) {
  await page.locator(`[data-id="${nodeId(label)}"]`).first().click();
  await page.locator('.activity-times-rows').waitFor();
  return page.locator('.activity-times-rows > div').evaluateAll(rows => rows.map(row => row.textContent));
}
const records = {Open: 6, Assign: 5, Close: 6, Check: 1};

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Map', exact: true}).click();
  await page.getByLabel('Process map of the kept incidents').waitFor();

  for (const [label, times] of Object.entries(expected.activities)) {
    const rows = await select(label);
    const row = (name, median, mean, count, none) => median === undefined
      ? `${name}Not available: ${none}.`
      : `${name}median ${hours(median)} · mean ${hours(mean)} · ${count} ${count === 1 ? 'passage' : 'passages'} of ${records[label]} ${records[label] === 1 ? 'record' : 'records'}`;
    const wanted = [
      row('From previous', times.medianPreviousHours, times.meanPreviousHours, times.usablePreviousCount, 'no labelled record comes before it in an incident whose order is known'),
      row('To next', times.medianNextHours, times.meanNextHours, times.usableNextCount, 'no labelled record follows it in an incident whose order is known'),
    ];
    check(`${label}_median_and_mean_over_the_same_passages`, JSON.stringify(rows) === JSON.stringify(wanted), {rows, wanted});
  }
  // The paths into Close, each with its median and mean lag.
  await select('Close');
  const into = await page.getByRole('region', {name: 'Paths in of Close'}).getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
  for (const [name, lag] of Object.entries(expected.paths).filter(([name]) => name.endsWith('>Close'))) {
    const from = name.split('>')[0];
    const said = `From ${from}: ${lag.usableLagCount} passages, median lag ${hours(lag.medianLagHours)}, mean lag ${hours(lag.meanLagHours)}. Select this path on the map.`;
    check(`path_${from}_to_Close_median_and_mean_lag`, into.includes(said), {into, said});
  }
  check('long_tail_parts_mean_and_median', hours(expected.activities.Open.meanNextHours) !== hours(expected.activities.Open.medianNextHours), null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
