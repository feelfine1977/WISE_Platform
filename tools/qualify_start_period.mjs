// The built browser selecting a period of first records (#11) in the invented tests/fixtures/starts file: the chart of
// starts names its anchor, periods, clock and cutoff and warns about short recent follow-up; a week band taken by
// keyboard is previewed and cancelled; the expanded table gives the same step and returns the focus on closing; applied,
// it keeps the oracle's incidents with their later records and the cutoff in evidence; Undo is exact; the date form
// with the same bounds gives the same identity. Every expectation comes from tests/fixtures/starts/expected.json.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {addStep} from './add_step.mjs';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 768}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [], previewed = [];
let trend = null;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (new URL(request.url()).pathname !== '/api/investigations/select-cases') return;
  const body = JSON.parse(request.postData() ?? '{}');
  if (body.request_id?.startsWith('preview-')) previewed.push(body.predicates.at(-1));
});
page.on('response', async response => {
  const path = new URL(response.url()).pathname;
  if (!response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (!answer) return;
  if (path === '/api/investigations/select-cases' && !answer.request_id.startsWith('preview-')) selections.push(answer);
  if (path === '/api/investigations/start-trend') trend = answer;
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areas = page.getByRole('navigation', {name: 'Areas'});
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
const wanted = expected.in_window;
const matches = answer => same(answer.kept.case_ids, wanted.kept) && same(answer.removed.case_ids, wanted.removed) && same(answer.unevaluable.case_ids, wanted.unevaluable);

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await settled(0);
  const parent = selections.at(-1);
  const chart = page.getByRole('group', {name: 'Incident starts per week'});
  await chart.waitFor();
  const column = (await page.locator('section.time-column').textContent()) ?? '';
  check('anchor_periods_clock_and_cutoff_named', /Each incident counts once, at the time of its first record in the declared order, not at its first labelled activity\. A period includes its start\s+and excludes its end, in UTC; the export was taken at 2026-03-31 00:00:00 UTC\./.test(column), null);
  check('short_follow_up_warned', /a recent period with fewer late records does\s+not by itself show an improvement/.test(column), null);
  check('parent_starts_per_week_match_the_oracle', trend && same(trend.bins.slice(0, expected.bins.length).map(bin => bin.parent_support.case_count), expected.bins)
    && trend.unevaluable.parent_support.case_count === expected.unevaluable, trend && trend.bins.map(bin => bin.parent_support.case_count));
  // The week band by keyboard: previewed, not taken; cancelled.
  await chart.focus();
  for (let step = 0; step <= expected.week_index_in_browser; step++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const pending = page.getByRole('group', {name: 'Step from the time charts not yet applied'});
  await pending.getByText(/^Preview:/).waitFor();
  const fromChart = previewed.at(-1);
  check('chart_band_has_the_oracle_bounds', same(fromChart.window, expected.window), fromChart);
  check('preview_takes_nothing', selections.at(-1) === parent || same(selections.at(-1).identity, parent.identity), null);
  await pending.getByRole('button', {name: 'Cancel', exact: true}).click();
  // Expanded: the table row of the same week gives the same step; closing returns the focus to Expand.
  await page.getByRole('button', {name: 'Expand the starts', exact: true}).click();
  const expanded = page.getByRole('region', {name: 'Incident starts per week, expanded'});
  await expanded.locator('tbody tr').nth(expected.week_index_in_browser).getByRole('button').click();
  await page.waitForFunction(() => document.activeElement?.textContent === 'Expand the starts');
  check('closing_the_expanded_view_returns_the_focus', true);
  await pending.getByText(/^Preview:/).waitFor();
  check('table_row_gives_the_same_step', same(previewed.at(-1), fromChart), previewed.at(-1));
  await pending.getByRole('button', {name: 'Apply', exact: true}).click();
  await settled(1);
  const applied = selections.at(-1);
  check('applied_period_matches_the_oracle', matches(applied), [applied.kept, applied.unevaluable]);
  // The kept incident keeps its later record outside the period; its evidence names the cutoff.
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Incidents', exact: true}).click();
  await page.locator('table tbody tr button.row-open', {hasText: new RegExp(`^${expected.later_record.case}$`)}).first().click();
  const records = page.getByRole('list', {name: `Records of incident ${expected.later_record.case} in the declared order`});
  await records.waitFor();
  const items = await records.getByRole('listitem').allTextContents();
  check('later_record_outside_the_period_kept', items.length === expected.later_record.records && items.some(item => item.includes(`source position ${expected.later_record.outside_period_position}`)), items.length);
  const observed = (await page.locator('p.observation-line').textContent()) ?? '';
  check('evidence_names_the_cutoff_and_age', observed.startsWith('The export was taken at 2026-03-31 00:00:00 UTC, ') && observed.includes('no sign that the incident was complete'), observed);
  await page.getByRole('button', {name: 'Return to incidents', exact: true}).click();
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  check('undo_restores_the_exact_parent', same(selections.at(-1).identity, parent.identity), null);
  // The date form with the same bounds: the same identity.
  const period = await addStep(page, 'First record in a period');
  await period.getByLabel('First record from (included)').fill(expected.window.start_inclusive.slice(0, 16));
  await period.getByLabel('Until (excluded)').fill(expected.window.end_exclusive.slice(0, 16));
  await period.getByRole('button', {name: 'Keep starts in this period', exact: true}).click();
  await settled(1);
  check('date_form_gives_the_same_identity', same(selections.at(-1).identity, applied.identity), null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
