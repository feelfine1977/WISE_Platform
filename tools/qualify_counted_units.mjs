// The built browser through the words of what is counted (#87) over the invented tests/fixtures/span-gap file: "About
// this map", "About these charts", "About stages" and "About this data" each open with one line saying what the numbers
// are, what each counts and over which incidents; the time column's charts and the tables name incidents, records or
// passages in their titles and heads; the numbers of the data row stay as they were.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

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
const view = name => page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name, exact: true});
/** Opens an "About" text by its button and gives its first line, then closes it again. */
async function lead(label) {
  await page.getByRole('button', {name: label, exact: true}).first().click();
  const panel = page.getByRole('group', {name: label, exact: true});
  await panel.waitFor();
  const first = await panel.evaluate(element => element.firstElementChild?.textContent ?? '');
  const isLead = await panel.evaluate(element => element.firstElementChild?.classList.contains('about-lead') ?? false);
  await page.keyboard.press('Escape');
  return {first, isLead};
}
const figures = () => page.locator('dl.population').first().textContent();

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await page.getByRole('navigation', {name: 'Areas'}).getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length === 8);
  await page.waitForFunction(() => /8 of 8 incidents/.test(document.querySelector('dl.population')?.textContent ?? ''));
  const before = await figures();

  await view('Map').click();
  await page.getByLabel('Process map of the kept incidents').waitFor();
  const map = await lead('About this map');
  check('about_this_map_opens_with_what_is_counted', map.isLead && /kept incidents/.test(map.first) && /records/.test(map.first) && /passages/.test(map.first), map);
  const charts = await lead('About these charts');
  check('about_these_charts_opens_with_what_is_counted', charts.isLead && charts.first.startsWith('Each column counts incidents') && /kept incidents/.test(charts.first) && /parent/.test(charts.first), charts);
  await page.getByRole('button', {name: 'Edit stages', exact: true}).click();
  const stages = await lead('About stages');
  check('about_stages_opens_with_what_is_counted', stages.isLead && /counts nothing of its own/.test(stages.first) && /incidents and records/.test(stages.first), stages);
  await page.getByRole('button', {name: 'Edit stages', exact: true}).click();
  const data = await lead('About this data');
  check('about_this_data_opens_with_what_is_counted', data.isLead && data.first.startsWith('The figures above count incidents and their records') && /parent/.test(data.first), data);

  // The charts of the time column and the heads of the tables name what they count.
  const titles = await page.locator('.time-chart-title').allTextContents();
  check('time_charts_name_incidents', titles.includes('Incidents by recorded span') && titles.some(title => /^Incident starts per /.test(title)), titles);
  await view('Incidents').click();
  const incidentHeads = await page.locator('.incident-table table thead th').allTextContents();
  check('incident_table_heads_name_records', ['Records', 'Mapped records', 'Records without activity label', 'Order of records'].every(head => incidentHeads.includes(head)), incidentHeads);
  await view('Paths').click();
  const pathHeads = await page.getByRole('table', {name: 'Paths of the kept incidents'}).locator('thead th').evaluateAll(heads => heads.map(head => head.getAttribute('aria-label') ?? head.textContent));
  check('path_table_heads_name_incidents_and_passages', ['Incidents', 'Passages', 'Median lag of the passages (h)'].every(head => pathHeads.includes(head)), pathHeads);
  await view('Matrix').click();
  // The matrix shows its pairs as a table on request.
  await page.getByRole('group', {name: 'Matrix layout'}).getByRole('button', {name: 'Table', exact: true}).click();
  await page.getByRole('table', {name: 'Pairs of the transition matrix'}).locator('thead th').first().waitFor();
  const matrixHeads = await page.getByRole('table', {name: 'Pairs of the transition matrix'}).locator('thead th').allTextContents();
  check('matrix_heads_name_incidents_and_passages', ['Incidents', 'Passages', 'Median lag of the passages (h)', 'Mean lag of the passages (h)'].every(head => matrixHeads.includes(head)), matrixHeads);
  // Only words changed: the data row's numbers are the same.
  check('no_number_changes', (await figures()) === before, [before, await figures()]);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
