// The built browser through two start periods (#18) of the fictional groups-and-periods.csv: the early period against
// the one including the latest starts, to the stored cutoff with a four-hour minimum and Resolved. The shared
// definitions, the measured, missing and not fully observed supports, the coverage kept as no conclusion, the declared
// follow-up restriction (G06 out, nothing else), the paired profiles and G07 opened with its resolution after its period
// are checked against expected.json, and no survival estimate or improvement claim appears.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const periods = config.expected.groups.periods;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 900}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], comparisons = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  if (new URL(response.url()).pathname !== '/api/investigations/compare-periods' || !response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (answer) comparisons.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areas = page.getByRole('navigation', {name: 'Areas'});
async function next(before) {
  while (comparisons.length === before) await page.waitForTimeout(100);
  await page.waitForFunction(() => document.querySelector('.compare-status')?.textContent?.startsWith('Comparison shown'));
  return comparisons.at(-1);
}
const rows = () => page.locator('.compare-table tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(cell => cell.textContent)));
const early = periods.early, late = periods.including_latest;

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length === 8);
  await areas.getByRole('button', {name: 'Compare', exact: true}).click();
  await page.getByRole('button', {name: 'Two periods', exact: true}).click();
  await page.getByLabel('First day of A').fill(early.start_inclusive.slice(0, 10));
  await page.getByLabel('Last day of A').fill('2026-10-02');
  await page.getByLabel('First day of B').fill(late.start_inclusive.slice(0, 10));
  await page.getByLabel('Last day of B').fill('2026-10-10');
  await page.getByLabel('Minimum follow-up in hours').fill('4');
  await page.getByLabel('Recorded activity to look for').selectOption('Resolved');
  await page.getByLabel('Opening value of').selectOption({label: 'Service'});
  let before = comparisons.length;
  await page.locator('button.compare-primary').click();
  const answer = await next(before);
  check('periods_as_the_oracle', same(answer.target.included.case_ids, early.case_ids) && same(answer.reference.included.case_ids, late.case_ids), null);
  const roles = (await page.locator('.compare-roles').textContent()) ?? '';
  check('definitions_shared_and_said', roles.includes('A from 2026-10-01 to 2026-10-03 (end excluded), B from 2026-10-09 to 2026-10-11 (end excluded)')
    && roles.includes('to the snapshot cutoff stored with the preparation, with a minimum follow-up of 4 hours and the recorded activity “Resolved”, and the same context')
    && roles.includes('Each case keeps its whole history, also after its period.'), roles);
  const all = await rows();
  const row = start => all.find(cells => cells[0].startsWith(start));
  check('measured_missing_and_inadequate_visible', row('Followed for less than 4 hours')[2].startsWith('1 of 3') && row('Followed for less than 4 hours')[1].startsWith('0 of 5')
    && row('“Resolved” recorded')[1].startsWith(`${early.recorded_resolution_count} of 5`) && row('No recorded “Resolved”')[2].startsWith(`${late.no_recorded_resolution_count} of 3`), all.map(cells => cells.slice(0, 3)));
  check('paired_profiles_shown', all.some(cells => cells[0].startsWith('First recorded with Service ERP')), null);
  const followup = page.getByRole('note', {name: 'Follow-up'});
  check('coverage_not_comparable_said', ((await followup.textContent()) ?? '').includes('Coverage is not comparable: 0 of 5 cases of Period A (0 %) and 1 of 3 cases of Period B (33 %) were followed for less than 4 hours'), await followup.textContent());
  await followup.getByRole('button', {name: 'Keep this as no conclusion', exact: true}).click();
  check('no_conclusion_kept', (await followup.getByRole('status').textContent()).startsWith('Kept: no conclusion about a change between Period A and Period B'), null);
  check('no_survival_or_improvement_claim', ((await followup.textContent()) ?? '').includes('No survival estimate is made here, and no difference between the periods is an improvement or a decline.'), null);

  // The cross-period incident opens with its whole history, after its period, and returns.
  await page.getByRole('group', {name: 'Inspect the cases of'}).getByRole('button', {name: 'B: Period B', exact: true}).click();
  await page.getByRole('list', {name: 'Cases of B, Period B'}).getByRole('button', {name: 'Open G07', exact: true}).click();
  const history = page.getByRole('region', {name: /^Case G07, of B/});
  await history.getByRole('table', {name: /^All 2 records of case G07/}).waitFor();
  const records = await history.getByRole('table').locator('tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(cell => cell.textContent)));
  check('cross_period_history_whole', records.length === 2 && records[1][4] === 'Resolved' && records[1][3].startsWith('2026-10-10'), records);
  await history.getByRole('button', {name: 'Return to the comparison', exact: true}).click();
  await page.waitForFunction(() => document.activeElement?.textContent === 'Open G07');
  check('return_restores_the_focus', true);

  // The declared follow-up restriction: G06 out, nothing else.
  await followup.getByRole('button', {name: 'Keep only cases followed for at least 4 hours', exact: true}).click();
  const parentNote = page.getByRole('note', {name: 'Parent'});
  check('restriction_declared_as_the_parent', ((await parentNote.textContent()) ?? '').includes('followed for at least 4 hours to the snapshot cutoff'), await parentNote.textContent());
  before = comparisons.length;
  await page.locator('button.compare-primary').click();
  const restricted = await next(before);
  check('restriction_removes_only_the_unobserved', same(restricted.target.included.case_ids, early.case_ids)
    && same(restricted.reference.included.case_ids, late.case_ids.filter(id => !late.inadequate_four_hour_followup_case_ids.includes(id))), restricted.reference.included.case_ids);
  check('one_follow_up_note', await page.locator('[aria-label="Follow-up"]').count() === 1, null);
  check('restricted_periods_fully_observed', ((await page.getByRole('note', {name: 'Follow-up'}).textContent()) ?? '').includes('Every case of both periods was followed for at least 4 hours'), null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
