// The built browser through Compare and Expectation at first use (#50), from an empty workspace with the packaged example
// S0 read through the ordinary operations.
// - desktop (1366 x 768): while the example's incidents are being opened, both areas say so and offer the investigation;
//   once they are there, both work on that exact workspace, preparation and population: a reviewed timing expectation is
//   checked and scored by the method library as the hand-written expected.json says, kept and removed incidents are
//   compared; a failed new score or comparison says that the previous one is still shown, and keeps it;
// - narrow (760 x 900), by the keyboard alone: a failure to open the incidents is named in Expectation with Try again,
//   which works; the example is scored there again, and two start periods of a second synthetic file are compared.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath, phase] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const narrow = phase === 'narrow';
const page = await (await browser.newContext({viewport: narrow ? {width: 760, height: 900} : {width: 1366, height: 768}})).newPage();
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [], sent = {};
let population = null;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const path = new URL(request.url()).pathname;
  if (request.method() === 'POST' && /^\/api\/(expectations|investigations\/compare)/.test(path)) (sent[path] ??= []).push(request.postDataJSON());
});
const replies = {};
page.on('response', async response => {
  const path = new URL(response.url()).pathname;
  if (!response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (!answer) return;
  if (path === '/api/investigations/select-cases' && !answer.request_id.startsWith('preview-')) selections.push(answer);
  if (path === '/api/investigations/open-population') population = answer;
  (replies[path] ??= []).push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
/** Equal values, whatever the order of their keys. */
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const areas = page.getByRole('navigation', {name: 'Areas'});
const area = name => areas.getByRole('button', {name, exact: true});
const view = name => page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name, exact: true});
/** An action by the keyboard alone in the narrow phase, by the pointer in the other. */
async function act(locator) {
  if (narrow) { await locator.focus(); await page.keyboard.press('Enter'); } else await locator.click();
}
async function type(locator, text) {
  if (narrow) { await locator.focus(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type(text); } else await locator.fill(text);
}
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
async function openReading(preparationId, count) {
  await act(area('Data'));
  await act(page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${preparationId}$`)}));
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, count);
  await settled(0);
}

/** Authors, checks and scores the expectation of the oracle on the incidents shown, and checks the run against it. */
async function score(label) {
  await act(area('Expectation'));
  const e = expected.expectation;
  const form = page.locator('form.expectation-form');
  await form.getByLabel('Start activity').selectOption(e.start);
  await form.getByLabel('Response activity').selectOption(e.response);
  await type(form.getByLabel('Target (hours)'), String(e.target_hours));
  await type(form.getByLabel('Width (hours partly met after the target)'), String(e.width_hours));
  await act(form.getByRole('radio', {name: 'Counted as not met'}));
  if (narrow) await page.keyboard.press('Space');
  await type(form.getByLabel('Name'), `First use ${label}`);
  await type(form.getByLabel('Owner'), 'Invented desk');
  await type(form.getByLabel('Source (for example a service agreement)'), 'Invented agreement');
  await type(form.getByLabel('Rationale'), 'Synthetic check of first use.');
  const reviewed = form.getByRole('checkbox', {name: /I have reviewed this definition/});
  if (narrow) { await reviewed.focus(); await page.keyboard.press('Space'); } else await reviewed.check();
  await act(form.getByRole('button', {name: 'Check the definition', exact: true}));
  const scoreButton = form.getByRole('button', {name: `Score ${expected.incidents} cases`, exact: true});
  await page.waitForFunction(() => { const button = [...document.querySelectorAll('form.expectation-form button')].find(item => item.textContent.startsWith('Score ')); return button && !button.disabled; });
  const before = (replies['/api/expectations/score'] ?? []).length;
  await act(scoreButton);
  for (let wait = 0; wait < 600 && (replies['/api/expectations/score'] ?? []).length === before; wait += 1) await page.waitForTimeout(100);
  const run = replies['/api/expectations/score'].at(-1).run;
  const request = sent['/api/expectations/score'].at(-1);
  check(`${label}_scored_on_the_exact_reading_and_population`, request.workspace_id === population.workspace_id && same(request.base_identity, population.identity)
    // With no step the investigation shows every incident of the reading, which is named by the reading's own identity.
    && same(request.named_population.identity, population.identity) && request.named_population.name.startsWith('every case of'), {request, population: population.identity});
  const values = Object.fromEntries(run.cases.map(verdict => [verdict.case_id, verdict.value]));
  check(`${label}_values_as_the_oracle`, same(Object.fromEntries(Object.entries(values).sort()), Object.fromEntries(Object.entries(e.values).sort())), values);
  await page.locator('.expectation-states').first().waitFor();
  const counts = Object.fromEntries(await page.locator('.expectation-state').evaluateAll(items => items.map(item => [item.querySelector('.expectation-state-label').textContent, Number(item.querySelector('.expectation-state-count').textContent)])));
  check(`${label}_counts_shown_as_the_oracle`, Object.entries(e.counts).every(([name, count]) => counts[name] === count), counts);
  return run;
}

try {
  if (!narrow) {
    // ---- while the example's incidents are being opened ----
    let release;
    const held = new Promise(done => { release = done; });
    await page.route('**/api/investigations/open-population', async route => { await held; await route.continue().catch(() => undefined); });
    await page.goto(base);
    await area('Compare').waitFor();
    await area('Compare').click();
    const comparePending = page.locator('.compare .area-prerequisite');
    await comparePending.getByRole('status').filter({hasText: 'are being opened'}).waitFor();
    check('compare_says_the_incidents_are_being_opened', ((await comparePending.textContent()) ?? '').includes('Comparisons are made in the cases') && await comparePending.getByRole('button', {name: 'Show the investigation'}).count() === 1, await comparePending.textContent());
    await area('Expectation').click();
    const expectationPending = page.locator('.expectation .area-prerequisite');
    await expectationPending.getByRole('status').filter({hasText: 'are being opened'}).waitFor();
    check('expectation_says_the_incidents_are_being_opened', ((await expectationPending.textContent()) ?? '').includes('An expectation is scored for the cases an investigation shows.'), await expectationPending.textContent());
    await expectationPending.getByRole('button', {name: 'Show the investigation'}).click();
    check('recovery_action_shows_the_investigation', await area('Investigations').getAttribute('aria-current') === 'page', null);
    release();
    await page.unroute('**/api/investigations/open-population');
    await page.getByRole('heading', {name: 'Map of the kept cases'}).waitFor();
    await settled(0);
    check('example_opened_with_every_incident', population.population.case_count === expected.incidents, population.population);

    // ---- a reviewed timing expectation on the example ----
    await score('desktop');
    check('method_build_named_honestly', ((await page.locator('.expectation-method-line').textContent()) ?? '').includes('not a published release'), await page.locator('.expectation-method-line').textContent());
    // A new score that fails says that the previous run is still shown, and shows it.
    await page.route('**/api/expectations/score', route => route.abort('connectionrefused'), {times: 1});
    await page.locator('form.expectation-form').getByRole('button', {name: `Score ${expected.incidents} cases`, exact: true}).click();
    await page.getByText('The cases could not be scored again; the previous run is still shown').waitFor();
    const keptCounts = await page.locator('.expectation-state-count').allTextContents();
    check('failed_score_keeps_the_previous_run', keptCounts.length > 0 && keptCounts.some(text => text === '8'), keptCounts);

    // ---- kept against removed, on the exact population ----
    await area('Investigations').click();
    await view('Paths').click();
    const paths = page.getByRole('table', {name: 'Paths of the kept cases'});
    await paths.getByRole('button', {name: `Path from “${expected.step.source}” to “${expected.step.target}”`, exact: true}).click();
    await page.getByRole('button', {name: `Keep cases where “${expected.step.target}” directly follows “${expected.step.source}”`, exact: true}).click();
    await settled(1);
    const kept = selections.at(-1);
    await area('Compare').click();
    await page.getByRole('button', {name: 'Kept against removed', exact: true}).click();
    await page.locator('main').getByRole('button', {name: 'Compare', exact: true}).click();
    await page.getByRole('status').filter({hasText: /^Comparison shown/}).waitFor();
    const groups = replies['/api/investigations/compare-groups'].at(-1);
    const asked = sent['/api/investigations/compare-groups'].at(-1);
    // Asked of the reading shown, its kept incidents against the ones the step removes.
    check('groups_compared_on_the_exact_selection', asked.workspace_id === population.workspace_id && same(asked.identity, population.identity)
      && same(groups.target.included.case_ids, expected.step.kept) && same(groups.reference.included.case_ids, expected.step.removed), {asked: asked.identity, target: groups.target.included.case_ids});
    await page.route('**/api/investigations/compare-groups', route => route.abort('connectionrefused'), {times: 1});
    await page.locator('main').getByRole('button', {name: 'Compare', exact: true}).click();
    await page.getByText('This comparison could not be made; the previous one is still shown').waitFor();
    check('failed_comparison_keeps_the_previous_one', await page.locator('.compare-result table').count() > 0 && same(selections.at(-1).identity, kept.identity), null);
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks, workspace_id: population.workspace_id, example_preparation_id: population.identity.preparation_id}));
  } else {
    // ---- by the keyboard in a narrow window: a failure to open the incidents, and its recovery ----
    await page.route('**/api/investigations/open-population', route => route.abort('connectionrefused'), {times: 1});
    await page.goto(base);
    await area('Expectation').waitFor();
    await act(area('Expectation'));
    const failed = page.locator('.expectation .area-prerequisite[role="alert"]');
    await failed.waitFor();
    check('failure_to_open_named_with_its_recovery', ((await failed.textContent()) ?? '').includes('The cases could not be opened, so this area has nothing to work on.')
      && await failed.getByRole('button', {name: 'Try again'}).count() === 1 && await failed.getByRole('button', {name: 'Go to the Data area'}).count() === 1, await failed.textContent());
    await act(failed.getByRole('button', {name: 'Try again'}));
    await page.locator('form.expectation-form').waitFor();
    check('try_again_opens_the_incidents', population !== null, null);
    // ---- the example scored by the keyboard ----
    await openReading(config.example_preparation_id, expected.incidents);
    await score('narrow');
    // ---- two start periods of a second synthetic file, compared by the keyboard ----
    const periods = config.periods;
    await openReading(config.periods_preparation_id, periods.case_count);
    await act(area('Compare'));
    await act(page.getByRole('button', {name: 'Two periods', exact: true}));
    // A date field takes its value from the browser's own date entry; the rest of the form is used by the keyboard.
    await page.getByLabel('First day of A').fill(periods.early.start_inclusive.slice(0, 10));
    await page.getByLabel('Last day of A').fill('2026-10-02');
    await page.getByLabel('First day of B').fill(periods.including_latest.start_inclusive.slice(0, 10));
    await page.getByLabel('Last day of B').fill('2026-10-10');
    await type(page.getByLabel('Minimum follow-up in hours'), '4');
    await page.getByLabel('Recorded activity to look for').selectOption('Resolved');
    await page.getByLabel('Opening value of').selectOption({label: 'Service'});
    await act(page.locator('button.compare-primary'));
    for (let wait = 0; wait < 600 && !(replies['/api/investigations/compare-periods'] ?? []).length; wait += 1) await page.waitForTimeout(100);
    const answer = replies['/api/investigations/compare-periods'].at(-1);
    const asked = sent['/api/investigations/compare-periods'].at(-1);
    check('periods_compared_on_the_exact_reading', asked.workspace_id === population.workspace_id && asked.identity.preparation_id === config.periods_preparation_id
      && same(answer.target.included.case_ids, periods.early.case_ids) && same(answer.reference.included.case_ids, periods.including_latest.case_ids), answer.target.included.case_ids);
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1);
    check('narrow_window_has_no_sideways_scroll', !overflow, null);
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks}));
  }
} finally {
  await browser.close();
}
