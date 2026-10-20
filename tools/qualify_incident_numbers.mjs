// The built browser keeping incidents by their numbers (#57) in the invented explorer core file. Review phase:
// - entries with an unknown or a repeated number are refused whole, naming the problem, and nothing is asked;
// - an entry is previewed and taken, and its chip and counts follow;
// - both kept incidents open with every record, the unlabelled ones included;
// - the same numbers in another order give the same identity;
// - the comparison of kept against removed incidents names the same groups;
// - the investigation is saved.
// Reopen phase, after an actual restart: the saved investigation reopens with the same chip and identity; Clear all
// leads to the parent and Undo back to exactly the saved selection. Every expectation comes from tests/fixtures/selection-journey/incident-numbers.json.
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
const errors = [], selections = [];
let comparison = null;
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  const path = new URL(response.url()).pathname;
  if (!response.ok()) return;
  if (path === '/api/investigations/select-cases') {
    const answer = await response.json().catch(() => null);
    if (answer) selections.push({preview: answer.request_id.startsWith('preview-'), answer});
  }
  if (path === '/api/investigations/compare-groups') comparison = await response.json().catch(() => null);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const areas = page.getByRole('navigation', {name: 'Areas'});
const count = (n, unit) => `${n} ${n === 1 ? unit : unit + 's'}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const committed = () => [...selections].reverse().find(entry => !entry.preview)?.answer;
const view = name => page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name, exact: true});
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => (document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n), steps);
}
async function enter(numbers) {
  // From the one entry of every step (#94); a refused entry leaves its form open.
  if (!(await page.getByLabel('Exact incident numbers').isVisible().catch(() => false))) await addStep(page, 'Incident numbers');
  const box = page.getByLabel('Exact incident numbers');
  await box.fill(numbers.join('\n'));
  await page.getByRole('button', {name: 'Keep these incidents', exact: true}).click();
}
async function openRecords(caseId) {
  await page.locator('table tbody tr button.row-open', {hasText: new RegExp(`^${caseId}$`)}).first().click();
  const list = page.getByRole('list', {name: `Records of incident ${caseId} in the declared order`});
  await list.waitFor();
  const items = await list.getByRole('listitem').allTextContents();
  await page.getByRole('button', {name: 'Return to incidents', exact: true}).click();
  return {all: items.length, unlabelled: items.filter(text => text.includes('no activity label')).length};
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  if (phase === 'review') {
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
    await addStep(page, 'Incident numbers');
    await page.getByLabel('Exact incident numbers').waitFor().catch(async error => {
      if (process.env.WISE_BROWSER_DUMP_TEXT) await writeFile(process.env.WISE_BROWSER_DUMP_TEXT, (await page.locator('main').first().textContent()) ?? '');
      throw error;
    });
    const parent = committed();
    // Refused whole: an unknown number is named; a repeated one is said; nothing is previewed or asked for.
    const asked = selections.length;
    await enter(expected.unknown_entry);
    check('unknown_number_refused_by_name', ((await page.getByRole('alert').textContent()) ?? '').includes(`Unknown incident numbers: ${expected.unknown_named}.`) , null);
    await enter(expected.duplicate_entry);
    check('repeated_number_refused', ((await page.getByRole('alert').textContent()) ?? '').startsWith('A number appears more than once'), null);
    check('refused_entries_ask_nothing', selections.length === asked, null);
    // Taken at once from "+ Add step" (#94): the chip and its counts.
    await enter(expected.entry);
    await settled(1);
    check('taken_at_once', selections.length === asked + 1 && await page.getByRole('group', {name: 'Add a step'}).count() === 0, selections.length);
    const kept = committed();
    check('kept_membership_matches_the_oracle', same(kept.kept.case_ids, expected.kept.ids) && kept.kept.record_count === expected.kept.records
      && same(kept.removed.case_ids, expected.removed.ids) && kept.removed.record_count === expected.removed.records, kept.kept);
    const chip = page.getByRole('list', {name: 'Steps of the selection'}).getByRole('listitem').first();
    const chipText = (await chip.textContent()) ?? '';
    // The chip of the trail (#93) holds its full wording, which names the numbers, behind its short one.
    const wording = (await chip.locator('.chip-wording').textContent()) ?? '';
    check('chip_names_the_numbers_and_counts', wording.startsWith(expected.chip) && chipText.includes(`Kept${count(expected.kept.ids.length, 'incident')} · ${count(expected.kept.records, 'record')}`), chipText);
    // Every record of each kept incident, the unlabelled ones included.
    await view('Incidents').click();
    const opened = {};
    for (const id of expected.kept.ids) opened[id] = await openRecords(id);
    check('every_record_of_kept_incidents', same(opened, expected.records), opened);
    // The same numbers in another order: the same selection, the same identity.
    await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
    await settled(0);
    check('undo_returns_to_the_parent', same(committed().identity, parent.identity), null);
    await enter(expected.reordered_entry);
    await settled(1);
    check('input_order_keeps_the_identity', same(committed().identity, kept.identity), null);
    // Kept against removed in Compare: the same two groups.
    await areas.getByRole('button', {name: 'Compare', exact: true}).click();
    await page.getByRole('button', {name: 'Kept against removed', exact: true}).click();
    await page.locator('main').getByRole('button', {name: 'Compare', exact: true}).click();
    await page.getByRole('status').filter({hasText: /^Comparison shown/}).waitFor();
    check('comparison_has_the_same_groups', comparison && same(comparison.target.included.case_ids, expected.kept.ids) && same(comparison.reference.included.case_ids, expected.removed.ids),
      comparison && [comparison.target.included.case_ids, comparison.reference.included.case_ids]);
    // Saved.
    await areas.getByRole('button', {name: 'Investigations', exact: true}).click();
    await page.getByRole('button', {name: 'Save', exact: true}).first().click();
    const form = page.locator('#saved-form');
    await form.getByLabel('Name').fill(config.saved_name);
    const [saved] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/save'), form.getByRole('button', {name: 'Save', exact: true}).click()]);
    check('investigation_saved', saved.status() === 200, saved.status());
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks, identity: kept.identity, parent_identity: parent.identity}));
  } else {
    await areas.getByRole('button', {name: 'Saved', exact: true}).click();
    const [reopened] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/reopen'),
      page.getByRole('button', {name: `Reopen ${config.saved_name}`, exact: true}).click()]);
    check('reopened', reopened.status() === 200, reopened.status());
    await page.getByRole('list', {name: 'Steps of the selection'}).waitFor();
    await settled(1);
    check('reopened_selection_has_the_saved_identity', same(committed().identity, config.identity), null);
    const reopenedChip = page.getByRole('list', {name: 'Steps of the selection'}).getByRole('listitem').first();
    const chipText = (await reopenedChip.textContent()) ?? '';
    const reopenedWording = (await reopenedChip.locator('.chip-wording').textContent()) ?? '';
    // The step keeps the numbers as last entered: the second entry, in its own order.
    check('reopened_chip_and_counts_agree', reopenedWording.startsWith(expected.reordered_chip) && chipText.includes(`Kept${count(expected.kept.ids.length, 'incident')} · ${count(expected.kept.records, 'record')}`), chipText);
    // A reopened investigation starts its history with its saved steps: Clear all leads to the parent, and Undo
    // brings back exactly the saved selection.
    await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Clear all', exact: true}).click();
    await settled(0);
    check('clear_after_reopen_returns_to_the_parent', same(committed().identity, config.parent_identity), null);
    await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
    await settled(1);
    check('undo_after_reopen_restores_the_saved_identity', same(committed().identity, config.identity), null);
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks}));
  }
} finally {
  await browser.close();
}
