// The built browser through many timelines with their records (#67) over the invented tests/fixtures/timelines file: the
// kept incidents by their span, each row's records as marks on one axis as long as the longest span listed, aligned at
// its first record, from bounded batches of marks; records at the same time are one mark with their count, records
// without a usable time are counted after the axis; the page and record counts are said; a row opens the same complete
// evidence and browsing changes no selection.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], batches = [], selections = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const path = new URL(request.url()).pathname;
  if (path === '/api/investigations/record-marks') batches.push(request.postDataJSON());
  if (path === '/api/investigations/select-cases') selections.push(request.postDataJSON());
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const table = () => page.getByRole('table', {name: 'Kept incidents'});
const row = caseId => table().locator('tbody tr').filter({has: page.getByRole('button', {name: caseId, exact: true})});

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await page.getByRole('navigation', {name: 'Areas'}).getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, 5);
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Incidents', exact: true}).click();
  await page.getByRole('group', {name: 'Order of the incidents'}).getByRole('button', {name: 'Longest span first', exact: true}).click();
  await page.waitForFunction(() => document.querySelectorAll('.record-marks').length === 5);
  const asked = selections.length;

  // ---- one axis, the longest span listed, from bounded batches ----
  const head = await table().getByRole('columnheader', {name: /^Records over time/}).textContent();
  check('axis_is_the_longest_span_listed', head.includes('Records over time, 0 to 10 h'), head);
  const ids = batches.flatMap(batch => batch.case_ids);
  check('marks_from_bounded_batches_each_incident_once', batches.length >= 1 && batches.every(batch => batch.case_ids.length <= 100) && new Set(ids).size === ids.length
    && same([...ids].sort(), Object.keys(expected.cases).sort()), batches.map(batch => batch.case_ids));
  const read = async caseId => row(caseId).locator('.record-marks').evaluate(marks => ({
    label: marks.getAttribute('aria-label'),
    marks: Array.from(marks.querySelectorAll('.record-marks-mark'), mark => [mark.getAttribute('x1'), mark.classList.contains('record-marks-tie')]),
    counts: Array.from(marks.querySelectorAll('.record-marks-count'), count => count.textContent),
    untimed: marks.querySelector('.record-marks-untimed')?.textContent ?? null,
  }));
  const one = await read('T-1');
  check('marks_aligned_at_the_first_record_on_the_common_axis', same(one.marks, [['0.000%', false], ['20.000%', false], ['50.000%', false]]) && one.label.startsWith('3 records over 5 h'), one);
  const two = await read('T-2');
  check('records_at_the_same_time_are_one_counted_mark', same(two.marks, [['0.000%', true], ['10.000%', true]]) && same(two.counts, ['2', '2'])
    && two.label.startsWith('4 of 4 records over 1 h, from the first record; 2 at the time of the first record; 2 together, 1 h after it'), two);
  const three = await read('T-3');
  check('records_without_a_time_counted_in_their_own_lane', same(three.marks, [['0.000%', false], ['100.000%', false]]) && three.untimed === '+1 without a time', three);
  const five = await read('T-5');
  check('an_incident_without_any_usable_time_is_said', five.marks.length === 0 && five.untimed === '+2 without a time' && five.label.startsWith('2 records, none with a usable time'), five);

  // ---- page and record support said; no row or record left out ----
  const more = (await page.locator('.incident-more').textContent()) ?? '';
  check('page_and_record_support_said', more.includes('5 incidents of 5') && more.includes('every one of the 13 records of these incidents is a mark on one axis of 10 h'), more);

  // ---- a row opens the same complete evidence; browsing changes no selection ----
  const [evidence] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/case-evidence'), table().getByRole('button', {name: 'T-2', exact: true}).click()]);
  await page.getByRole('heading', {name: 'Incident T-2'}).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('ol.history > li').length > 0);
  check('row_opens_the_complete_evidence', (await evidence.json()).records.length === 4 && await page.locator('ol.history > li').count() === 4, null);
  check('browsing_changes_no_selection', selections.length === asked, [asked, selections.length]);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
