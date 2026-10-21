// The built browser through the transition matrix (#12) of the invented tests/fixtures/matrix file: each measure of each
// cell equals the hand-written expected.json; absent pairs and rows no pair leaves are named; the repeated pair has more
// passages than incidents; the bridge and the tie open their incidents with the original rows marked and the focus
// returns; a cell's step is previewed, cancelled and applied with the focus on the cell, and undone; the map's paths under
// the same relation carry the same numbers; at a small window the page is not widened.
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
const errors = [], selections = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  if (new URL(response.url()).pathname !== '/api/investigations/select-cases' || !response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (answer && !answer.request_id.startsWith('preview-')) selections.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areas = page.getByRole('navigation', {name: 'Areas'});
const view = name => page.getByRole('group', {name: 'View'}).getByRole('button', {name, exact: true});
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
const pane = () => page.getByRole('region', {name: 'Transitions between activities'});
const grid = () => pane().getByRole('table', {name: /^Transition matrix/});
const cellButton = (from, to) => grid().getByRole('button', {name: new RegExp(`^From ${from} to ${to}:`)});
const one = new Intl.NumberFormat('en', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const wanted = {
  incidents: cell => String(cell.cases.length), passages: cell => String(cell.passages), outgoing: cell => `${one.format(cell.outgoing_share * 100)} %`,
  median: cell => one.format(cell.lag.median), mean: cell => one.format(cell.lag.mean),
};
const labels = {incidents: 'Incidents', passages: 'Passages', outgoing: 'Outgoing share', median: 'Median lag', mean: 'Mean lag'};

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, expected.incidents);
  await settled(0);
  const asked = selections.length;
  await view('Matrix').click();
  await grid().waitFor();
  const text = (await pane().textContent()) ?? '';
  check('relation_and_denominators_named', text.includes('incident.relation.direct_succession_in_activity_sequence.v1') && text.includes('It is neither a co-occurrence nor an indirect relation')
    && text.includes(`Of the ${expected.incidents} incidents kept, ${expected.case_denominator} incidents have a known order. 1 incident with no known order is in no cell.`), text);
  const columns = await grid().locator('thead th').allTextContents();
  check('activities_in_their_order', same(columns.slice(1), expected.activities), columns);

  // Every measure of every cell, one measure at a time, with its key.
  for (const [measure, label] of Object.entries(labels)) {
    await pane().getByRole('group', {name: 'Measure in the cells'}).getByRole('button', {name: label, exact: true}).click();
    const shown = [];
    for (const cell of expected.cells) shown.push(await cellButton(cell.from, cell.to).textContent());
    check(`${measure}_of_every_cell`, same(shown, expected.cells.map(wanted[measure])), [shown, expected.cells.map(wanted[measure])]);
  }
  await pane().getByRole('group', {name: 'Measure in the cells'}).getByRole('button', {name: 'Incidents', exact: true}).click();
  const rowHeads = await grid().locator('tbody th').allTextContents();
  check('empty_denominators_named', Object.entries(expected.rows).every(([activity, out]) => rowHeads.some(head => head.startsWith(activity) && head.includes(out === 0 ? 'no pair leaves it' : `${out} out`))), rowHeads);
  check('absent_pair_named_not_zero', await grid().getByText('No pair from Opened to Closed').count() === 1, null);

  // The repeated pair, by keyboard: more passages than incidents.
  await cellButton('Opened', 'Assigned').focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('region', {name: 'From Opened to Assigned'});
  const repeated = (await panel.textContent()) ?? '';
  check('repeat_adds_passages_not_incidents', repeated.includes('3 incidents of the 6 incidents whose order is known (50.0 %)') && repeated.includes('4 passages; a repeat in one incident adds a passage, not an incident')
    && repeated.includes('66.7 % of the 6 passages leaving Opened'), repeated);

  // The bridge and the tie open their incidents with the rows of the passage marked; the focus returns.
  for (const [from, to, witness, kind] of [['Opened', 'Resolved', expected.bridge_witness, 'bridge'], ['Assigned', 'Resolved', expected.tie_witness, 'tie']]) {
    await cellButton(from, to).click();
    const cellPanel = page.getByRole('region', {name: `From ${from} to ${to}`});
    const said = (await cellPanel.textContent()) ?? '';
    check(`${kind}_disclosed`, kind === 'bridge' ? said.includes('1 passage in 1 incident pass over records without an activity label') : said.includes('1 passage between two records with the same time, ordered by the declared rule'), said);
    const open = cellPanel.getByRole('button', {name: `Open incident ${witness.case}`});
    await open.click();
    await page.getByRole('list', {name: `Records of incident ${witness.case} in the declared order`}).waitFor();
    const flagged = await page.locator('li.history-entry[data-contributing="true"]').evaluateAll(entries => entries.map(entry => /source position (\d+)/.exec(entry.textContent)?.[1]).map(Number));
    const rows = kind === 'bridge' ? [witness.source_position, ...witness.omitted_positions, witness.target_position] : [witness.source_position, witness.target_position];
    check(`${kind}_rows_marked_in_the_history`, same([...flagged].sort((a, b) => a - b), [...rows].sort((a, b) => a - b)), flagged);
    await page.getByRole('button', {name: 'Return to incidents', exact: true}).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(name => document.activeElement?.textContent === name, `Open incident ${witness.case}`);
    check(`${kind}_return_restores_the_focus`, selections.length === asked, null);
  }

  // A cell's step: previewed, cancelled, applied with the focus on the cell, undone.
  await cellButton('Opened', 'Assigned').click();
  const stepPanel = page.getByRole('region', {name: 'From Opened to Assigned'});
  await stepPanel.getByRole('button', {name: 'Preview keeping these incidents'}).click();
  const line = await stepPanel.getByText(/^Preview:/).textContent();
  const keep = expected.keep_opened_assigned;
  check('preview_exact', line.startsWith(`Preview: would keep ${keep.kept.length} incidents of ${expected.incidents} incidents; ${expected.incidents - keep.kept.length - keep.unevaluable.length} removed, ${keep.unevaluable.length} not evaluable.`), line);
  await stepPanel.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('From Opened to Assigned:'));
  check('cancel_takes_nothing_and_keeps_the_cell', selections.length === asked, null);
  await stepPanel.getByRole('button', {name: 'Preview keeping these incidents'}).click();
  await stepPanel.getByRole('button', {name: 'Apply', exact: true}).focus();
  await page.keyboard.press('Enter');
  await settled(1);
  const applied = selections.at(-1);
  check('cell_step_keeps_whole_incidents', same(applied.kept.case_ids, keep.kept) && same(applied.unevaluable.case_ids, keep.unevaluable), applied.kept);
  await page.waitForFunction(n => document.body.textContent.includes(`Of the ${n} incidents kept`), keep.kept.length);
  check('matrix_follows_the_selection', true);
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  await page.waitForFunction(n => document.body.textContent.includes(`Of the ${n} incidents kept`), expected.incidents);
  check('undo_restores_the_matrix', true);

  // The map's paths, under the same relation, carry the same incidents, passages and median lag.
  await pane().getByRole('group', {name: 'Matrix layout'}).getByRole('button', {name: 'Table', exact: true}).click();
  const tableRows = await pane().getByRole('table', {name: 'Pairs of the transition matrix'}).locator('tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(cell => cell.textContent)));
  const fromMatrix = tableRows.map(cells => [cells[0], cells[1], cells[2], cells[4]]).sort();
  await view('Paths').click();
  const pathRows = await page.getByRole('table', {name: 'Paths of the kept incidents'}).locator('tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(cell => cell.textContent)));
  const fromMap = pathRows.filter(cells => cells[0] !== 'Start' && cells[1] !== 'End').map(cells => [`${cells[0]} → ${cells[1]}`, cells[2], cells[3], cells[4]]).sort();
  check('map_paths_carry_the_same_numbers', same(fromMatrix, fromMap), [fromMatrix, fromMap]);

  // A small window: the matrix scrolls in its own frame, and the page is not widened.
  await page.setViewportSize({width: 683, height: 384});
  await view('Matrix').click();
  await grid().waitFor();
  const widened = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('small_window_not_widened', widened <= 1, widened);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
