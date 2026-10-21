// The built browser through two pinned histories (#19) of the invented tests/fixtures/pinned file. From the incidents first
// recorded at one desk, a kept incident is pinned as supporting and a removed one, read in the selection's parent, as
// contrary; both are read side by side with every record, row and mark of the oracle and the context of both first
// records, nothing matched. Returning restores the focus and the selection; a pin opens from the index and returns to it.
// On a narrow window both sides stay named and whole; after the steps changed both are still read in their own
// population; a refused handle is said on its side while the other stays. Expectations: tests/fixtures/pinned/expected.json.
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
const errors = [], selections = [], evidence = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (new URL(request.url()).pathname === '/api/investigations/case-evidence') evidence.push(JSON.parse(request.postData() ?? '{}'));
});
page.on('response', async response => {
  if (new URL(response.url()).pathname !== '/api/investigations/select-cases' || !response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (answer && !answer.request_id.startsWith('preview-')) selections.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areas = page.getByRole('navigation', {name: 'Areas'});
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
const rail = name => page.getByRole('group', {name: 'Side panel'}).getByRole('button', {name, exact: true});
const tableIds = () => page.locator('table tbody tr button.row-open').allTextContents();
const longLabel = `Seen twice at the East desk before it moved West — ${'a long label that must wrap and stay whole '.repeat(3).trim()}`;
const paired = () => page.getByRole('region', {name: 'Two pinned histories'});
const side = (role, caseId) => paired().getByRole('region', {name: `${role} · Case ${caseId}`});
async function sideRows(role, caseId) {
  const table = side(role, caseId).getByRole('table', {name: new RegExp(`^All \\d+ records? of case ${caseId} in the declared order`)});
  await table.waitFor();
  return table.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.children].map(cell => cell.textContent)));
}
async function pinOpen(caseId, role, label, observation) {
  await page.locator('table tbody tr button.row-open', {hasText: new RegExp(`^${caseId}$`)}).click();
  await page.getByRole('heading', {name: `Case ${caseId}`}).waitFor();
  const control = page.getByRole('region', {name: 'Pin this history'});
  if (label) await control.getByLabel('Label').fill(label);
  if (observation) {
    await control.getByText('Notes, none required').click();
    await control.getByLabel('Observation').fill(observation);
  }
  await control.getByRole('button', {name: `Pin as ${role}`, exact: true}).click();
  await control.getByRole('status').getByText(`Pinned as ${role}.`).waitFor();
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, expected.incidents);
  await settled(0);

  // The journey starts from a category: the incidents first recorded at one desk.
  await page.getByRole('button', {name: 'Filters and views'}).click();
  await rail('Context').click();
  const context = page.getByRole('region', {name: 'At the first recorded observation'});
  await context.getByRole('list', {name: `Opening values of ${expected.step.column}, most frequent first`}).getByRole('checkbox', {name: `Choose ${expected.step.value}`, exact: true}).check();
  await context.getByRole('button', {name: 'Preview keeping cases first recorded with these values', exact: true}).click();
  await context.getByRole('group', {name: `Values of ${expected.step.column} not yet applied`}).getByRole('button', {name: 'Apply', exact: true}).click();
  await settled(1);
  const question = selections.at(-1);
  check('category_step_as_the_oracle', same(question.kept.case_ids, expected.kept) && same(question.removed.case_ids, expected.removed) && same(question.unevaluable.case_ids, expected.unevaluable), question.kept);
  const asked = selections.length;
  await page.getByRole('group', {name: 'View'}).getByRole('button', {name: 'Cases', exact: true}).click();

  // A kept incident pinned as supporting; the focus returns to its row.
  const supporting = expected.supporting, contrary = expected.contrary;
  await pinOpen(supporting.case, 'supporting', longLabel, 'Assigned twice; the desk changed.');
  await page.getByRole('button', {name: 'Return to cases', exact: true}).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(id => document.activeElement?.textContent === id, supporting.case);
  check('return_from_a_kept_history_restores_its_row', true);

  // A removed incident is listed, opened in the selection's parent and pinned as contrary.
  const listed = page.getByRole('group', {name: 'Cases listed'});
  await listed.getByRole('button', {name: `Removed (${expected.removed.length})`}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, expected.removed.length);
  check('removed_incidents_listed', same((await tableIds()).sort(), expected.removed), await tableIds());
  await pinOpen(contrary.case, 'contrary');
  const contraryAsk = evidence.filter(body => body.case_id === contrary.case).at(-1);
  check('contrary_read_in_the_parent', same(contraryAsk.identity, question.parent_identity), contraryAsk.identity);
  const focusLine = (await page.locator('.focus-line').textContent()) ?? '';
  check('contrary_named_as_removed', focusLine.startsWith(`You are reading one case of the ${expected.removed.length} cases the selection removes, in its parent of ${expected.incidents} cases`), focusLine);
  await page.getByRole('button', {name: 'Return to cases', exact: true}).click();
  await listed.getByRole('button', {name: `Kept (${expected.kept.length})`}).click();

  // The index names both, with role and origin; the two are read side by side.
  await rail('Pinned').click();
  const index = page.getByRole('region', {name: 'Pinned histories'});
  const indexText = (await index.textContent()) ?? '';
  check('index_names_roles_origins_and_populations', indexText.includes(`Supporting · Case ${supporting.case}`) && indexText.includes(`Contrary · Case ${contrary.case}`)
    && indexText.includes('Kept by the selection: one of') && indexText.includes('Removed by the selection: one of') && indexText.includes(longLabel), indexText);
  const pairButton = index.getByRole('button', {name: 'Read the two chosen side by side'});
  check('two_pins_chosen_by_default', !(await pairButton.isDisabled()), await index.locator('input[type=checkbox]').evaluateAll(boxes => boxes.map(box => box.checked)));
  await pairButton.focus();
  await page.keyboard.press('Enter');
  await paired().waitFor();
  const left = await sideRows('Supporting', supporting.case);
  const right = await sideRows('Contrary', contrary.case);
  const positions = rows => rows.map(row => Number(row[1]));
  const activities = rows => rows.map(row => (row[4] === 'no activity label' ? null : row[4]));
  const marks = rows => rows.map(row => (row.at(-1) ? row.at(-1).split('; ') : []));
  check('both_histories_whole_in_declared_order', same(positions(left), supporting.source_positions) && same(positions(right), contrary.source_positions)
    && same(activities(left), supporting.activities) && same(activities(right), contrary.activities), [left, right]);
  check('rows_named_by_their_identifiers', [...left, ...right].every(row => /^row\.v1:sha256:[0-9a-f]{64}$/.test(row[2])) && new Set([...left, ...right].map(row => row[2])).size === left.length + right.length, null);
  check('repeats_ties_missing_labels_and_context_changes_marked', same(marks(left), supporting.marks) && same(marks(right), contrary.marks), [marks(left), marks(right)]);
  const contextRows = await paired().getByRole('region', {name: 'Context at the first record of each'}).locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.children].map(cell => cell.textContent)));
  check('context_beside_each_other_as_recorded', same(contextRows, expected.context_at_first.map(row => [row.name, row.supporting ?? 'not recorded', row.contrary ?? 'not recorded', row.reading])), contextRows);
  const pairedText = (await paired().textContent()) ?? '';
  check('nothing_matched_or_concluded', pairedText.includes('WISE does not match, score or explain them') && pairedText.includes('no other case is looked for to match either one'), null);
  check('origins_on_both_sides', pairedText.includes('Kept by the selection: one of 2 cases of 5 cases') && pairedText.includes('Removed by the selection: one of 2 cases it removes, read in its parent of 5 cases'), null);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.textContent === 'Read the two chosen side by side');
  check('return_restores_the_focus_and_the_question', selections.length === asked && await page.getByRole('list', {name: 'Steps of the selection'}).getByRole('listitem').count() === 1, selections.length);

  // A pin opens from the index in its own population, and the focus returns to its Open button.
  await index.getByRole('button', {name: `Open the history of Case ${contrary.case}`}).click();
  await page.getByRole('heading', {name: `Case ${contrary.case}`}).waitFor();
  check('pin_opens_in_its_population', (await page.locator('.focus-line').textContent()).startsWith('You are reading a pinned history in the population it was pinned in'), null);
  await page.getByRole('button', {name: 'Return to cases', exact: true}).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Open the history of Case'));
  check('return_from_a_pin_restores_its_button', true);

  // A narrow window: one side under the other, both named, the long label whole, every record reachable.
  await page.setViewportSize({width: 600, height: 800});
  await pairButton.click();
  await paired().waitFor();
  const narrow = await page.evaluate(() => {
    const sides = [...document.querySelectorAll('.paired-side')].map(element => element.getBoundingClientRect());
    const overflowing = [...document.querySelectorAll('.paired-side h4, .paired-side .pin-label')].some(element => element.scrollWidth > element.clientWidth + 1);
    return {stacked: sides.length === 2 && sides[1].top >= sides[0].bottom - 1, overflowing, widened: document.documentElement.scrollWidth - document.documentElement.clientWidth};
  });
  check('narrow_window_keeps_both_sides_named_and_whole', narrow.stacked && !narrow.overflowing && narrow.widened <= 1, narrow);
  check('narrow_window_keeps_every_record', (await sideRows('Supporting', supporting.case)).length === supporting.source_positions.length
    && (await sideRows('Contrary', contrary.case)).length === contrary.source_positions.length, null);
  await page.getByRole('button', {name: 'Return to the question', exact: true}).click();
  await page.setViewportSize({width: 1366, height: 768});

  // After the steps changed, both pins are still read in their own population, and say so.
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  await rail('Pinned').click();
  await pairButton.click();
  await paired().waitFor();
  await sideRows('Supporting', supporting.case);
  await sideRows('Contrary', contrary.case);
  check('pins_outlive_a_changed_selection', await paired().getByText(/^Pinned under other steps than those shown now/).count() === 2, null);
  await page.getByRole('button', {name: 'Return to the question', exact: true}).click();

  // A refused handle is said on its side; the other side and the question stay.
  await page.route('**/api/investigations/case-evidence', async route => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.case_id !== contrary.case) return route.continue();
    await route.fulfill({status: 404, contentType: 'application/json', body: JSON.stringify({schema_version: 1, message_type: 'import_refusal', request_id: body.request_id,
      query_revision: body.query_revision, workspace_id: body.workspace_id, operation: 'case_evidence', code: 'case_not_found',
      message: `The case ${contrary.case} is not in this population.`, field: 'case_id', retryable: false})});
  });
  await pairButton.click();
  await paired().waitFor();
  const alert = await side('Contrary', contrary.case).getByRole('alert').textContent();
  check('refused_handle_said_on_its_side', alert.includes(`The history of case ${contrary.case} cannot be read in the population it was pinned in.`), alert);
  check('other_side_stays', (await sideRows('Supporting', supporting.case)).length === supporting.source_positions.length, null);
  await page.unroute('**/api/investigations/case-evidence');
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
