// The built browser from a first launch to the map of every incident (#48, #49), over an empty workspace.
// - first: the packaged example S0 is stored and read through the ordinary operations and opens on the map of all its
//   incidents; the data row names the cutoff; the paths list counts as the hand-written oracle; a path step is
//   previewed and applied with exact support; the incidents are one action away; kept and removed are compared; the
//   expectation offers the example's activities; the investigation is saved from the Incidents view;
// - again, after an actual restart, with a stale remembered reading in the browser: the reading listed in the workspace
//   opens instead, the example is not read again, and the saved investigation reopens on its own view and step.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath, phase] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const context = await browser.newContext({viewport: {width: 1366, height: 768}});
if (phase === 'again') {
  // A reading remembered in this browser that the workspace does not list: it must not be opened.
  await context.addInitScript(workspaceId => window.localStorage.setItem('wise-platform.last-reading',
    JSON.stringify({workspaceId, preparationId: `preparation.v1:sha256:${'0'.repeat(64)}`, steps: []})), config.workspace_id);
}
const page = await context.newPage();
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [], requests = [];
let population = null, comparison = null;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(`${request.method()} ${new URL(request.url()).pathname}`));
page.on('response', async response => {
  const path = new URL(response.url()).pathname;
  if (!response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (!answer) return;
  if (path === '/api/investigations/select-cases' && !answer.request_id.startsWith('preview-')) selections.push(answer);
  if (path === '/api/investigations/open-population') population = answer;
  if (path === '/api/investigations/compare-groups') comparison = answer;
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areas = page.getByRole('navigation', {name: 'Areas'});
const view = name => page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name, exact: true});
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}

try {
  await page.goto(base);
  await page.getByRole('heading', {name: 'Map of the kept cases'}).waitFor();
  await settled(0);
  if (phase === 'first') {
    check('opens_on_the_map_without_a_question', await view('Map').getAttribute('aria-pressed') === 'true', null);
    check('example_read_through_the_ordinary_operations', requests.includes('PUT /api/sources') && requests.includes('POST /api/preparations')
      && !requests.some(entry => entry.includes('open-example')), requests.filter(entry => entry.startsWith('POST') || entry.startsWith('PUT')));
    check('whole_population_counted', population.population.case_count === expected.incidents && population.population.record_count === expected.records
      && selections.at(-1).predicate_results.length === 0, population.population);
    await page.getByRole('button', {name: 'About this data', exact: true}).click();
    const details = (await page.locator('.data-details').textContent()) ?? '';
    check('quality_and_cutoff_rules_named', details.includes('Export taken at') && details.includes('Row rule') && details.includes('Time policy'), null);
    await page.keyboard.press('Escape');
    // The paths list counts incidents per path and flow as the oracle does.
    await view('Paths').click();
    const paths = page.getByRole('table', {name: 'Paths of the kept cases'});
    await paths.waitFor();
    const listed = Object.fromEntries(await paths.locator('tbody tr').evaluateAll(rows => rows.map(row => [row.children[0].textContent + ' > ' + row.children[1].textContent, Number(row.children[2].textContent)])));
    const wanted = {...Object.fromEntries(Object.entries(expected.paths)), ...Object.fromEntries(Object.entries(expected.starts).map(([activity, count]) => [`Start > ${activity}`, count])),
      ...Object.fromEntries(Object.entries(expected.ends).map(([activity, count]) => [`${activity} > End`, count]))};
    check('paths_and_flows_count_as_the_oracle', same(Object.keys(listed).sort(), Object.keys(wanted).sort()) && Object.entries(wanted).every(([key, count]) => listed[key] === count), listed);
    // A path step with exact support, previewed then applied; Undo restores the question.
    const parent = selections.at(-1);
    await paths.getByRole('button', {name: `Path from “${expected.step.source}” to “${expected.step.target}”`, exact: true}).click();
    const keep = page.getByRole('button', {name: `Keep cases where “${expected.step.target}” directly follows “${expected.step.source}”`, exact: true});
    const preview = page.locator(`#${await keep.getAttribute('aria-describedby')}`);
    await preview.filter({hasText: /^Preview:/}).waitFor();
    check('preview_reports_exact_support', ((await preview.textContent()) ?? '').startsWith(`Preview: would keep ${expected.step.kept.length} cases of ${expected.incidents} cases`), await preview.textContent());
    await keep.click();
    await settled(1);
    const kept = selections.at(-1);
    check('step_keeps_the_oracle_s_incidents', same(kept.kept.case_ids, expected.step.kept) && kept.kept.record_count === expected.step.kept_records, kept.kept);
    await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
    await settled(0);
    check('undo_restores_the_question', same(selections.at(-1).identity, parent.identity), null);
    await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Redo', exact: true}).click();
    await settled(1);
    // The incidents and their complete histories are one action away.
    await view('Cases').click();
    await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, expected.step.kept.length);
    check('incidents_one_action_away', true);
    // #59: the incident read is marked and named apart from the selection, which reading it does not change.
    const asked = selections.length;
    const focused = expected.step.kept[0];
    await page.locator('table tbody tr button.row-open', {hasText: new RegExp(`^${focused}$`)}).first().click();
    await page.getByRole('heading', {name: `Case ${focused}`}).waitFor();
    const line = (await page.locator('.focus-line').textContent()) ?? '';
    const marked = await page.locator('table tbody tr button.row-open[aria-current="true"]').allTextContents();
    check('focused_history_distinct_from_selection', line === `You are reading one case of the ${expected.step.kept.length} cases the selection keeps of ${expected.incidents} cases (1 step); reading it changes no step.`
      && same(marked, [focused]) && selections.length === asked && await page.getByRole('list', {name: 'Steps of the selection'}).getByRole('listitem').count() === 1, [line, marked]);
    await page.getByRole('button', {name: 'Return to cases', exact: true}).click();
    // Kept against removed in Compare.
    await areas.getByRole('button', {name: 'Compare', exact: true}).click();
    await page.getByRole('button', {name: 'Kept against removed', exact: true}).click();
    await page.locator('main').getByRole('button', {name: 'Compare', exact: true}).click();
    await page.getByRole('status').filter({hasText: /^Comparison shown/}).waitFor();
    check('comparison_reached', comparison && same(comparison.target.included.case_ids, expected.step.kept), comparison && comparison.target.included.case_ids);
    // The expectation is offered over the example's activities.
    await areas.getByRole('button', {name: 'Expectation', exact: true}).click();
    const options = await page.getByLabel('Start activity').locator('option').allTextContents();
    check('expectation_reached', expected.activities.every(activity => options.includes(activity)), options);
    // Saved from the Incidents view.
    await areas.getByRole('button', {name: 'Investigations', exact: true}).click();
    await view('Cases').click();
    await page.getByRole('button', {name: 'Save', exact: true}).first().click();
    const form = page.locator('#saved-form');
    await form.getByLabel('Name').fill(config.saved_name);
    const [saved] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/save'), form.getByRole('button', {name: 'Save', exact: true}).click()]);
    check('investigation_saved', saved.status() === 200, saved.status());
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks, workspace_id: population.workspace_id, preparation_id: population.identity.preparation_id, identity: kept.identity}));
  } else {
    check('stale_remembered_reading_not_opened', population.identity.preparation_id === config.preparation_id, population.identity);
    check('example_not_read_again', !requests.includes('PUT /api/sources'), requests.filter(entry => entry.startsWith('PUT')));
    await areas.getByRole('button', {name: 'Saved', exact: true}).click();
    await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/reopen'),
      page.getByRole('button', {name: `Reopen ${config.saved_name}`, exact: true}).click()]);
    await page.getByRole('list', {name: 'Steps of the selection'}).waitFor();
    await settled(1);
    check('reopened_selection_matches', same(selections.at(-1).identity, config.identity), null);
    check('reopened_on_its_saved_view', await view('Cases').getAttribute('aria-pressed') === 'true', null);
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks}));
  }
} finally {
  await browser.close();
}
