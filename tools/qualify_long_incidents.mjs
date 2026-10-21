// The built browser keeping long incidents (#60) of the invented tests/fixtures/intervals file:
// - review: the chart of recorded spans keeps the incidents of at least four hours by keyboard, exactly four included,
//   the order-unknown one unevaluable; the typed filter of the same threshold gives the same identity; the incident list
//   ordered by span shows the same incidents at or above it; Undo restores the parent; kept against removed are
//   compared; the investigation is saved;
// - reopen, after an actual restart: the same chip, identity and membership.
// Every expectation comes from tests/fixtures/intervals/long-incidents.json.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {addStep} from './add_step.mjs';

const [base, output, playwright, chrome, configPath, phase] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 768}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [], lists = [];
let comparison = null;
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  const path = new URL(response.url()).pathname;
  if (!response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (!answer) return;
  if (path === '/api/investigations/select-cases' && !answer.request_id.startsWith('preview-')) selections.push(answer);
  if (path === '/api/investigations/case-list') lists.push(answer);
  if (path === '/api/investigations/compare-groups') comparison = answer;
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areas = page.getByRole('navigation', {name: 'Areas'});
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
const wanted = expected.span_at_least_4;
const partitionMatches = answer => same(answer.kept.case_ids, wanted.kept) && same(answer.removed.case_ids, wanted.removed) && same(answer.unevaluable.case_ids, wanted.unevaluable);

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  if (phase === 'review') {
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
    await settled(0);
    const parent = selections.at(-1);
    // The chart of spans: the third column (4 h to 1 d) by keyboard keeps the incidents of at least four hours.
    const chart = page.getByRole('group', {name: 'Cases by recorded span'});
    await chart.waitFor();
    await chart.focus();
    for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    // The column is previewed first, then applied.
    await page.getByRole('group', {name: 'Step from the time charts not yet applied'}).getByRole('button', {name: 'Apply', exact: true}).click();
    await settled(1);
    const fromChart = selections.at(-1);
    check('chart_step_matches_the_oracle', partitionMatches(fromChart), [fromChart.kept, fromChart.unevaluable]);
    check('exactly_four_hours_is_kept', fromChart.kept.case_ids.includes('I-4H'), null);
    const chip = (await page.getByRole('list', {name: 'Steps of the selection'}).locator('.chip-wording').first().textContent()) ?? '';
    check('chip_names_the_definition', chip === 'Keep cases with recorded span at least 4 hours', chip);
    // The incident list ordered by span shows the same incidents at or above the threshold.
    await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Cases', exact: true}).click();
    await page.getByRole('button', {name: 'Longest span first', exact: true}).click();
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
    const listAnswer = lists.at(-1);
    const shownSpans = Object.fromEntries(listAnswer.rows.map(row => [row.case_id, row.time_summary.observed_span_hours ?? null]));
    check('list_shows_the_same_incidents_at_or_above', same(Object.keys(shownSpans).sort(), wanted.kept) && Object.entries(shownSpans).every(([caseId, hours]) => hours === expected.spans[caseId] && hours >= 4), shownSpans);
    // Undo, then the typed filter of the same threshold: the same identity.
    await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
    await settled(0);
    check('undo_restores_the_parent', same(selections.at(-1).identity, parent.identity), null);
    const time = await addStep(page, 'Recorded time');
    await time.getByLabel('Measure').selectOption('observed_span_at_least');
    await time.getByLabel('At least this many hours').fill('4');
    await time.getByRole('button', {name: 'Keep by recorded time', exact: true}).click();
    await settled(1);
    check('typed_filter_gives_the_same_identity', same(selections.at(-1).identity, fromChart.identity), null);
    // Kept against removed in Compare: the same two groups; the unknown is in neither.
    await areas.getByRole('button', {name: 'Compare', exact: true}).click();
    await page.getByRole('button', {name: 'Kept against removed', exact: true}).click();
    await page.locator('main').getByRole('button', {name: 'Compare', exact: true}).click();
    await page.getByRole('status').filter({hasText: /^Comparison shown/}).waitFor();
    check('comparison_has_kept_and_removed', comparison && same(comparison.target.included.case_ids, wanted.kept) && same(comparison.reference.included.case_ids, wanted.removed),
      comparison && [comparison.target.included.case_ids, comparison.reference.included.case_ids]);
    await areas.getByRole('button', {name: 'Investigations', exact: true}).click();
    await page.getByRole('button', {name: 'Save', exact: true}).first().click();
    const form = page.locator('#saved-form');
    await form.getByLabel('Name').fill(config.saved_name);
    const [saved] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/save'), form.getByRole('button', {name: 'Save', exact: true}).click()]);
    check('investigation_saved', saved.status() === 200, saved.status());
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks, identity: fromChart.identity, chips: [chip]}));
  } else {
    await areas.getByRole('button', {name: 'Saved', exact: true}).click();
    await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/reopen'),
      page.getByRole('button', {name: `Reopen ${config.saved_name}`, exact: true}).click()]);
    await page.getByRole('list', {name: 'Steps of the selection'}).waitFor();
    await settled(1);
    check('reopened_identity_matches', same(selections.at(-1).identity, config.identity), null);
    check('reopened_membership_matches_the_oracle', partitionMatches(selections.at(-1)), selections.at(-1).kept);
    const chip = (await page.getByRole('list', {name: 'Steps of the selection'}).locator('.chip-wording').first().textContent()) ?? '';
    check('reopened_chip_matches', same([chip], config.chips), chip);
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks}));
  }
} finally {
  await browser.close();
}
