// The built browser over an invented ticketing log in the year-first slash shape (#52): read first with a format
// that reads none of its times, the summary and the investigation say why no order, path or variant follows and lead
// back to the Data area; there the year-first format, offered with how many values it reads, is chosen, compared with
// the first reading and published; its incidents have paths, and the original cells keep their fractional seconds.
// Every expectation comes from tests/fixtures/ymd-slash/expected.json. Only checks and identities are written.
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
const areas = page.getByRole('navigation', {name: 'Areas'});
const columns = ['Case ID', 'Activity', 'Complete Timestamp', 'Resource'];
const YMD = 'Year/Month/Day, 24-hour clock with seconds and optional fractional seconds (2026/12/31 17:45:10.123)';
const WRONG = 'Day/Month/Year, 24-hour clock with seconds (31/12/2026 17:45:10)';

async function answered(path, action) {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST'), action()]);
  return response;
}
async function press(locator, key = 'Enter') { await locator.focus(); await page.keyboard.press(key); }
async function role(label, column) {
  const select = page.getByLabel(label, {exact: true});
  const value = await select.evaluate((element, name) => [...element.options].find(option => option.text.startsWith(`${name} — `))?.value, column);
  assert.ok(value !== undefined, `${label}: no option for ${column}`);
  await select.selectOption(value);
}
async function readAndConfirm() {
  await press(page.getByRole('button', {name: 'Read the source with these choices', exact: true}));
  const summary = page.getByRole('region', {name: 'What WISE understood'});
  await summary.waitFor();
  await page.getByRole('status').filter({hasText: 'Some rows have issues'}).waitFor();
  const text = (await summary.textContent()) ?? '';
  const compared = await page.getByRole('table', {name: 'Compared with the previous reading of this source'}).count()
    ? await page.getByRole('table', {name: 'Compared with the previous reading of this source'}).evaluate(table =>
      Object.fromEntries([...table.querySelectorAll('tbody tr')].map(row => [row.querySelector('th').textContent, [...row.querySelectorAll('td')].map(cell => cell.textContent)])))
    : null;
  await press(page.getByRole('checkbox', {name: 'I have read the rows with issues; keep them as described above.'}), 'Space');
  await press(page.getByRole('button', {name: 'Confirm and prepare', exact: true}));
  await page.getByRole('status').filter({hasText: 'Ready: the source is read with these choices'}).waitFor();
  return {text, compared};
}
const formatChoice = label => page.getByRole('radio', {name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)});
const formatEvidence = label => formatChoice(label).evaluate(input => input.closest('label')?.textContent ?? '');

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByLabel('Add an event-history CSV').setInputFiles(config.file);
  await page.getByRole('heading', {name: `How ${expected.file} is written`}).waitFor();
  await page.getByLabel('Incident id', {exact: true}).waitFor();
  await role('Incident id', columns[expected.mapping.case_column]);
  await role('Activity', columns[expected.mapping.activity_column]);
  await role('Time', columns[expected.mapping.timestamp_column]);
  // The new format is offered with what it reads; the format first chosen reads none of these times.
  check('year_first_format_offered_with_its_reads', (await formatEvidence(YMD)).endsWith(`reads ${expected.inspection_reads} filled cells of ${expected.wall.report.raw_record_count} filled cells`), await formatEvidence(YMD));
  await formatChoice(WRONG).check();
  await page.getByRole('radio', {name: 'As recorded: no zone is applied'}).check();
  // The field takes minutes; the screen adds the seconds, as for any cutoff entered there.
  await page.getByLabel('Export taken at (as recorded)').fill(expected.wall.cutoff_local.slice(0, 16));
  const wrong = await readAndConfirm();
  check('summary_says_no_order_can_follow', wrong.text.includes('No record has a usable time with these choices, so the order of no incident is known'), null);
  await answered('/api/investigations/open-population', () => press(page.getByRole('button', {name: 'Open incidents', exact: true})));
  const note = page.getByRole('note').filter({hasText: 'The order of no incident is known'});
  await note.waitFor();
  check('investigation_says_why_no_paths_or_variants', ((await note.textContent()) ?? '').includes('no paths, no variants and no durations'), null);
  // Recovery: back to the Data area, the year-first format, a new reading compared with the first.
  await press(note.getByRole('button', {name: 'Change how the times are read, in the Data area', exact: true}));
  await formatChoice(YMD).check();
  const right = await readAndConfirm();
  check('summary_no_longer_warns', !right.text.includes('No record has a usable time'), null);
  check('change_compared_with_the_unreadable_reading', right.compared?.['With a usable time']?.join(' | ') ===
    `0 records | ${expected.wall.report.usable_timestamp_record_count} records | +${expected.wall.report.usable_timestamp_record_count}`, right.compared);
  await answered('/api/investigations/open-population', () => press(page.getByRole('button', {name: 'Open incidents', exact: true})));
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  check('no_warning_once_times_are_read', await page.getByRole('note').filter({hasText: 'The order of no incident is known'}).count() === 0, null);
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Paths', exact: true}).click();
  const paths = page.getByRole('table', {name: 'Paths of the kept incidents'});
  await paths.waitFor();
  check('paths_follow_from_the_read_times', await paths.getByRole('button', {name: /^Path from /}).count() > 0, null);
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Incidents', exact: true}).click();
  await page.locator('table tbody tr button.row-open', {hasText: /^Case 1$/}).first().click();
  await page.getByRole('list', {name: 'Records of incident Case 1 in the declared order'}).waitFor();
  check('original_cells_keep_the_fraction', ((await page.locator('main').first().textContent()) ?? '').includes('2010/01/13 08:40:25.123'), null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
