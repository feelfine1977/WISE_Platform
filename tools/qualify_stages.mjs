// The built browser through the stages of a log (#70) over the invented tests/fixtures/stage-proposal file.
// Phase "define": in the editor of the stages beside the map, the Phase column is counted on every record of each labelled
// activity of the kept incidents, as the hand-written expected.json says, mixed values listed and nothing put into a stage;
// the analyst takes a value for the mixed activity, the proposal for the unmixed ones and overrides one by hand; the
// editor shows the phase column and where each stage came from, the map draws the stages with their names and its legend
// names them, and no incident, step or count changes; counted again for the incidents a step keeps, the values are those of
// the kept incidents; the investigation is saved with its stages. Phase "reopen", after an actual restart and in a browser
// that kept nothing: the saved stages come back with their origins and are drawn; a saved investigation whose stages name
// an activity the log does not have says so on the map and in the editor, draws it in no stage, and takes it out on request.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath, phase] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const NAME = 'Invented stages', STALE = 'Stale stages';
const nodeId = label => `activity.v1:sha256:${createHash('sha256').update(label, 'utf8').digest('hex')}`;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await (await browser.newContext({viewport: {width: 1440, height: 900}})).newPage();
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [], graphs = [], saves = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const path = new URL(request.url()).pathname;
  if (path === '/api/investigations/select-cases' && !request.postDataJSON()?.request_id?.startsWith('preview-')) selections.push(request.postDataJSON());
  if (path === '/api/investigations/process-graph') graphs.push(request.postDataJSON());
  if (path === '/api/investigations/save') saves.push(request.postDataJSON());
});
const answers = [];
page.on('response', async response => {
  if (new URL(response.url()).pathname !== '/api/investigations/select-cases' || !response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (answer && !answer.request_id.startsWith('preview-')) answers.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** An object with its keys in order, so that two are compared by what they hold. */
const byKey = object => Object.fromEntries(Object.entries(object).sort(([one], [other]) => one.localeCompare(other)));
const areas = page.getByRole('navigation', {name: 'Areas'});
const views = () => page.getByRole('group', {name: 'View', exact: true});
const editor = () => page.getByRole('region', {name: 'Stages of this log'});
const activities = () => editor().getByRole('table', {name: 'Activities and their stage'});

async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
async function openEditor() {
  if (await editor().count()) return;
  await page.getByRole('group', {name: 'Map tools'}).getByRole('button', {name: 'Edit stages'}).click();
  await editor().waitFor();
}
async function closeEditor() {
  if (await editor().count()) await page.getByRole('button', {name: 'Close the editor of the stages'}).click();
  await editor().waitFor({state: 'detached'});
}
/** The stage boxes on the map, by the names written on them. */
const boxes = () => page.locator('[data-wf-part="group"][data-wf-kind="stage"] [data-wf-part="group-label"]').allTextContents();
/** The stage boxes once the map is arranged anew for the stages: it is drawn again after a change of them. */
async function drawn(count) {
  await page.waitForFunction(n => document.querySelectorAll('[data-wf-part="group"][data-wf-kind="stage"] [data-wf-part="group-label"]').length === n, count, {timeout: 20000})
    .catch(async () => console.error('groups on the map:', await page.evaluate(() => Array.from(document.querySelectorAll('[data-wf-part*="group"], [data-wf-kind]'), node => `${node.getAttribute('data-wf-part')}/${node.getAttribute('data-wf-kind')}:${node.textContent.slice(0, 30)}`).slice(0, 20))));
  return boxes();
}
/** Each activity of the editor's table: its stage and where it came from. */
const assigned = () => activities().locator('tbody tr').evaluateAll(rows => Object.fromEntries(rows.map(row => {
  const select = row.querySelector('select');
  return [row.querySelector('th').textContent, [select.selectedOptions[0]?.textContent ?? '', row.querySelector('.stages-origin')?.textContent ?? '']];
})));
/** The numbers the map writes on each activity. */
const counts = () => page.evaluate(ids => ids.map(id => document.querySelector(`[data-id="${id}"] .wf-activity-counts`)?.textContent ?? null), ['Open', 'Assign', 'Work', 'Close'].map(nodeId));
async function count() {
  await editor().getByLabel('Phase column', {exact: true}).selectOption({label: 'Phase'});
  await editor().getByRole('button', {name: 'Count the values', exact: true}).click();
  await editor().getByRole('table', {name: 'Values of Phase by activity'}).waitFor();
}
const rows = () => editor().getByRole('table', {name: 'Values of Phase by activity'}).locator('tbody tr').evaluateAll(items => items.map(row => Array.from(row.children).slice(0, 5).map(cell => cell.textContent)));
const wanted = entries => entries.map(item => [item.activity, String(item.record_count), `${item.mixed ? 'Mixed: ' : ''}${item.values.map(([value, n]) => `“${value}” ${n}`).join(' · ')}`,
  String(item.missing_record_count), item.leading ? `“${item.leading[0]}”, ${item.leading[1]} record${item.leading[1] === 1 ? '' : 's'} of ${item.record_count}` : 'None: values tie']);

async function openReading() {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, expected.incidents.length);
  await settled(0);
}
async function reopen(name) {
  await areas.getByRole('button', {name: 'Saved', exact: true}).click();
  await page.getByRole('button', {name: `Reopen ${name}`, exact: true}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, expected.incidents.length);
  await settled(0);
  await views().getByRole('button', {name: 'Map', exact: true}).click();
  await page.getByLabel('Process map of the kept incidents').waitFor();
}

try {
  if (phase === 'define') {
    await openReading();
    await views().getByRole('button', {name: 'Map', exact: true}).click();
    await page.getByLabel('Process map of the kept incidents').waitFor();
    const before = {selections: selections.length, graphs: graphs.length, identity: answers.at(-1).identity, kept: answers.at(-1).kept.case_ids, counts: await counts()};
    check('map_without_stages_at_first', same(await boxes(), []), await boxes());

    // ---- the proposal: every record of each labelled activity, mixed values listed, nothing taken ----
    await openEditor();
    await count();
    check('values_counted_on_every_record_as_the_oracle', same(await rows(), wanted(expected.every_incident.activities)), {rows: await rows(), wanted: wanted(expected.every_incident.activities)});
    const kept = expected.every_incident.kept;
    check('counted_records_and_unlabelled_said', (await editor().textContent()).includes(`Phase: counted on ${kept.labelled_record_count} records with an activity label of the ${kept.case_count} kept incidents; ${kept.unlabelled_record_count} record without an activity label is in no activity.`), null);
    check('nothing_put_into_a_stage_by_the_proposal', Object.values(await assigned()).every(([stage]) => stage === 'No stage') && same(await boxes(), []), await assigned());
    check('phase_column_named', (await editor().textContent()).includes('Phase column: Phase.'), null);

    // ---- the analyst takes a value for the mixed activity, the proposal for the rest, and overrides one by hand ----
    const values = editor().getByRole('table', {name: 'Values of Phase by activity'});
    await values.getByRole('button', {name: 'Put “Assign” in the stage “Intake”'}).click();
    await editor().getByRole('button', {name: 'Take the proposal for 3 activities whose records hold one value'}).click();
    await activities().getByRole('combobox', {name: 'Stage of “Work”'}).selectOption({label: 'Intake'});
    const taken = await assigned();
    check('stages_and_origins_shown', same(byKey(taken), byKey({Open: ['Intake', 'Phase “Intake”'], Assign: ['Intake', 'Phase “Intake”'], Work: ['Intake', 'Set by hand'], Close: ['Closure', 'Phase “Closure”']})), taken);
    check('stage_names_drawn_on_the_map', same((await drawn(2)).sort(), ['Closure', 'Intake']), await boxes());
    // Named in the legend under the map too: told apart by name, not by colour alone.
    const legend = page.locator('.map-legend');
    await legend.getByRole('button', {name: 'Show the whole legend'}).click();
    const named = await legend.locator('.wf-legend__cat').allTextContents();
    check('legend_names_the_stages', named.includes('Intake') && named.includes('Closure'), named);
    const after = {selections: selections.length, graphs: graphs.length, identity: answers.at(-1).identity, kept: answers.at(-1).kept.case_ids, counts: await counts()};
    check('stages_change_no_incident_step_or_count', after.selections === before.selections && after.graphs === before.graphs && same(after.identity, before.identity)
      && same(after.kept, before.kept) && same(after.counts, before.counts) && after.counts.every(text => text !== null), {before, after});

    // ---- counted again for the incidents a step keeps ----
    await closeEditor();
    await page.locator(`[data-id="${nodeId('Work')}"]`).first().click();
    await page.getByRole('button', {name: 'Keep incidents that contain it', exact: true}).click();
    await settled(1);
    check('step_keeps_the_oracles_incidents', same(answers.at(-1).kept.case_ids, expected.with_work.kept), answers.at(-1).kept.case_ids);
    await openEditor();
    await count();
    check('values_counted_for_the_kept_incidents', same(await rows(), wanted(expected.with_work.activities)), await rows());
    await closeEditor();
    await page.getByRole('group', {name: 'Steps', exact: true}).getByRole('button', {name: 'Undo', exact: true}).click();
    await settled(0);

    // ---- saved with the investigation ----
    await page.getByRole('button', {name: 'Save', exact: true}).click();
    const form = page.getByRole('region', {name: 'Save this investigation'});
    await form.getByLabel('Name').fill(NAME);
    await form.getByRole('button', {name: 'Save', exact: true}).click();
    await page.locator('#saved-form').getByRole('status').getByText(`Saved as the new investigation “${NAME}”.`).waitFor();
    const stages = saves.at(-1).presentation_state?.stages;
    check('saved_with_its_stages_bound_to_the_reading', stages?.preparation_id === saves.at(-1).base_identity.preparation_id && stages.phase_column_index === expected.phase_column
      && same(stages.stages.map(stage => stage.name), ['Intake', 'Closure', 'Handling'])
      && same(Object.fromEntries(stages.assignments.map(item => [item.activity, item.origin.kind === 'manual' ? 'manual' : item.origin.value])), {Assign: 'Intake', Close: 'Closure', Open: 'Intake', Work: 'manual'}), stages);
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks, base_identity: saves.at(-1).base_identity, selection_identity: saves.at(-1).selection_identity,
      parent_case_ids: saves.at(-1).selection_recipe.parent_case_ids, stages}));
  } else {
    // ---- after a restart, in a browser that kept nothing: the stages come from the saved investigation ----
    await page.goto(base);
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
    check('browser_kept_no_stages', await page.evaluate(() => Object.keys(window.localStorage).filter(key => key.startsWith('wise-platform.stages')).length) === 0, null);
    await reopen(NAME);
    check('reopened_stages_drawn', same((await drawn(2)).sort(), ['Closure', 'Intake']), await boxes());
    await openEditor();
    check('reopened_stages_said_with_their_origins', (await editor().textContent()).includes(`The stages saved with the investigation “${NAME}”.`)
      && same(byKey(await assigned()), byKey({Open: ['Intake', 'Phase “Intake”'], Assign: ['Intake', 'Phase “Intake”'], Work: ['Intake', 'Set by hand'], Close: ['Closure', 'Phase “Closure”']}))
      && (await editor().textContent()).includes('Phase column: Phase.'), await assigned());
    await closeEditor();

    // ---- stages naming an activity the log does not have: said, drawn in no stage, taken out on request ----
    await reopen(STALE);
    const line = page.locator('.map-limit').filter({hasText: 'put into a stage is not in this log'});
    check('stale_assignment_said_on_the_map', ((await line.textContent()) ?? '').startsWith('1 activity put into a stage is not in this log and is drawn in no stage.'), await line.textContent().catch(() => null));
    check('stale_activity_not_drawn', await page.locator(`[data-id="${nodeId('Gone')}"]`).count() === 0 && same((await drawn(2)).sort(), ['Closure', 'Intake']), await boxes());
    await line.getByRole('button', {name: 'Edit stages'}).click();
    await editor().waitFor();
    const note = editor().locator('.stages-stale');
    check('stale_assignment_named_in_the_editor', ((await note.textContent()) ?? '').includes('1 activity put into a stage is not in this log, so it is drawn in no stage: “Gone”.'), await note.textContent());
    await note.getByRole('button', {name: 'Take it out of its stage'}).click();
    await note.waitFor({state: 'detached'});
    check('stale_assignment_taken_out_on_request', await page.locator('.map-limit').filter({hasText: 'put into a stage is not in this log'}).count() === 0, null);
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks}));
  }
} finally {
  await browser.close();
}
