// The built browser keeping incidents that start in a period (#62) of the invented tests/fixtures/starts file:
// - review: a week band from the chart of starts by keyboard, previewed and applied, names its bounds and clock in its
//   chip; kept against removed are compared; Undo and Redo restore exact identities; the investigation is saved;
// - reopen, after an actual restart: the same chip, identity and membership.
// Every expectation comes from tests/fixtures/starts/expected.json.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath, phase] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 768}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [];
let comparison = null;
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  const path = new URL(response.url()).pathname;
  if (!response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (!answer) return;
  if (path === '/api/investigations/select-cases' && !answer.request_id.startsWith('preview-')) selections.push(answer);
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
const wanted = expected.in_window;
const matches = answer => same(answer.kept.case_ids, wanted.kept) && same(answer.removed.case_ids, wanted.removed) && same(answer.unevaluable.case_ids, wanted.unevaluable);
const chipText = async () => (await page.getByRole('list', {name: 'Steps of the selection'}).locator('.chip-wording').first().textContent()) ?? '';

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  if (phase === 'review') {
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
    await settled(0);
    const parent = selections.at(-1);
    const chart = page.getByRole('group', {name: 'Incident starts per week'});
    await chart.waitFor();
    await chart.focus();
    for (let step = 0; step <= expected.week_index_in_browser; step++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.getByRole('group', {name: 'Step from the time charts not yet applied'}).getByRole('button', {name: 'Apply', exact: true}).click();
    await settled(1);
    const applied = selections.at(-1);
    check('window_matches_the_oracle', matches(applied) && same(applied.predicate_results[0].predicate.window, expected.window), [applied.kept, applied.predicate_results[0].predicate]);
    const chip = await chipText();
    check('chip_names_bounds_and_clock', chip.includes('end excluded') && chip.includes('UTC'), chip);
    await areas.getByRole('button', {name: 'Compare', exact: true}).click();
    await page.getByRole('button', {name: 'Kept against removed', exact: true}).click();
    await page.locator('main').getByRole('button', {name: 'Compare', exact: true}).click();
    await page.getByRole('status').filter({hasText: /^Comparison shown/}).waitFor();
    check('comparison_has_kept_and_removed', comparison && same(comparison.target.included.case_ids, wanted.kept) && same(comparison.reference.included.case_ids, wanted.removed),
      comparison && [comparison.target.included.case_ids, comparison.reference.included.case_ids]);
    await areas.getByRole('button', {name: 'Investigations', exact: true}).click();
    await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
    await settled(0);
    check('undo_restores_the_parent', same(selections.at(-1).identity, parent.identity), null);
    await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Redo', exact: true}).click();
    await settled(1);
    check('redo_restores_the_window', same(selections.at(-1).identity, applied.identity), null);
    await page.getByRole('button', {name: 'Save', exact: true}).first().click();
    const form = page.locator('#saved-form');
    await form.getByLabel('Name').fill(config.saved_name);
    const [saved] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/save'), form.getByRole('button', {name: 'Save', exact: true}).click()]);
    check('investigation_saved', saved.status() === 200, saved.status());
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks, identity: applied.identity, chips: [chip]}));
  } else {
    await areas.getByRole('button', {name: 'Saved', exact: true}).click();
    await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/reopen'),
      page.getByRole('button', {name: `Reopen ${config.saved_name}`, exact: true}).click()]);
    await page.getByRole('list', {name: 'Steps of the selection'}).waitFor();
    await settled(1);
    const reopened = selections.at(-1);
    check('reopened_identity_matches', same(reopened.identity, config.identity), null);
    check('reopened_window_and_membership_match', matches(reopened) && same(reopened.predicate_results[0].predicate.window, expected.window), reopened.kept);
    check('reopened_chip_matches', same([await chipText()], config.chips), await chipText());
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks}));
  }
} finally {
  await browser.close();
}
