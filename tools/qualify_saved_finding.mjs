// The built browser through a saved finding (#25) of the invented tests/fixtures/frozen-parent file, in two phases around
// an actual restart of the service. First: the eligibility step and the clause, a supporting and a contrary pin, a
// comparison in the frozen parent, the outcome, and a save with structured notes, its summary and its unsaved draft.
// Again, in a new service process: the saved list's lineage, cutoff, folder and unchecked state; the reopened notes, pins,
// frozen parent and outcome; the question applied to a refreshed reading, reviewed and saved as a new revision while the
// earlier one stays and reopens.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath, phase] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 900}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [], saves = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (new URL(request.url()).pathname === '/api/investigations/save') saves.push(JSON.parse(request.postData() ?? '{}'));
});
const saveReplies = [];
page.on('response', async response => {
  if (new URL(response.url()).pathname === '/api/investigations/save') saveReplies.push(await response.json().catch(() => null));
  if (new URL(response.url()).pathname !== '/api/investigations/select-cases' || !response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (answer && !answer.request_id.startsWith('preview-') && !answer.request_id.startsWith('parent-')) selections.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const areas = page.getByRole('navigation', {name: 'Areas'});
const view = name => page.getByRole('group', {name: 'View'}).getByRole('button', {name, exact: true});
const rail = name => page.getByRole('group', {name: 'Side panel'}).getByRole('button', {name, exact: true});
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
async function openReading(preparationId) {
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${preparationId}$`)}).click();
}
async function pin(caseId, role, words) {
  await page.locator('table tbody tr button.row-open', {hasText: new RegExp(`^${caseId}$`)}).click();
  await page.getByRole('list', {name: `Records of case ${caseId} in the declared order`}).waitFor();
  const control = page.getByRole('region', {name: 'Pin this history'});
  await control.getByText('Notes, none required').click();
  for (const [label, text] of Object.entries(words)) await control.getByLabel(label).fill(text);
  await control.getByRole('button', {name: `Pin as ${role}`, exact: true}).click();
  await control.getByRole('status').getByText(`Pinned as ${role}.`).waitFor();
  await page.getByRole('button', {name: 'Return to cases', exact: true}).click();
}
const NAME = 'Resolution by team, frozen parent';

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  if (phase === 'first') {
    await openReading(config.preparation_id);
    await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, expected.incidents);
    await settled(0);
    // The eligibility step, then the clause.
    await view('Paths').click();
    await page.getByRole('table', {name: 'Paths of the kept cases'}).locator('tbody tr').filter({has: page.locator('th', {hasText: /^Start$/})})
      .filter({has: page.locator('td', {hasText: /^Opened$/})}).locator('th button').click();
    await page.getByRole('button', {name: 'Keep cases that begin with it', exact: true}).click();
    await settled(1);
    await view('Map').click();
    await page.locator('.react-flow__node-activity', {hasText: 'Resolved'}).first().click();
    await page.getByRole('button', {name: 'Keep cases that contain it', exact: true}).click();
    await settled(2);
    // Two witnesses, one kept and one removed.
    await view('Cases').click();
    await pin('F01', 'supporting', {Observation: 'Resolved within two hours.'});
    await page.getByRole('group', {name: 'Cases listed'}).getByRole('button', {name: /^Removed/}).click();
    await pin('F04', 'contrary', {Limitation: 'The export may end before a resolution.'});
    await page.getByRole('group', {name: 'Cases listed'}).getByRole('button', {name: /^Kept/}).click();
    // The comparison in the frozen parent, and the outcome.
    await areas.getByRole('button', {name: 'Compare', exact: true}).click();
    await page.getByRole('button', {name: 'Kept against removed', exact: true}).click();
    await page.getByRole('note', {name: 'Parent'}).waitFor();
    await page.locator('button.compare-primary').click();
    await page.waitForFunction(() => document.querySelector('.compare-status')?.textContent?.startsWith('Comparison shown'));
    const outcome = page.getByRole('region', {name: 'Outcome by opening value'});
    await outcome.getByLabel('Activity of the outcome').selectOption('Resolved');
    await outcome.getByLabel(/^its absence/).check();
    await outcome.getByRole('button', {name: 'Show the outcome by value', exact: true}).click();
    await outcome.getByRole('table').waitFor();
    // The save: its summary, structured notes, an unsaved draft kept across closing the form.
    await areas.getByRole('button', {name: 'Investigations', exact: true}).click();
    await page.getByRole('button', {name: 'Save', exact: true}).click();
    const form = page.getByRole('region', {name: 'Save this investigation'});
    const summary = (await form.getByLabel('What this save holds').textContent()) ?? '';
    check('summary_names_everything_saved', summary.includes('frozen-parent') || summary.includes(expected.file)
      && summary.includes('Recorded “Resolved”') && summary.includes('kept by Keep cases that begin with “Opened”')
      && summary.includes('no recorded “Resolved” at the snapshot') && summary.includes('Supporting · Case F01 (F01); Contrary · Case F04 (F04)')
      && summary.includes('none: an unscored question is saved as it is'), summary);
    await form.getByLabel('Name').fill(NAME);
    await form.getByLabel('Question').fill('Do resolved cases differ by team?');
    await form.getByLabel('Counterexample').fill('F04 has no recorded resolution.');
    await form.getByRole('button', {name: 'Close', exact: true}).click();
    await page.getByRole('button', {name: 'Save', exact: true}).click();
    const again = page.getByRole('region', {name: 'Save this investigation'});
    check('draft_kept_and_said_unsaved', (await again.getByLabel('Question').inputValue()) === 'Do resolved cases differ by team?'
      && ((await again.getByRole('note').textContent()) ?? '').startsWith('Unsaved draft'), null);
    await again.getByLabel('Limitation').fill('Seven invented cases.');
    await again.getByRole('button', {name: 'Save', exact: true}).focus();
    await page.keyboard.press('Enter');
    for (let wait = 0; wait < 600 && saveReplies.length === 0; wait += 1) await page.waitForTimeout(100);
    if (saveReplies.length === 0) check('save_sent', false, saves);
    check('save_answered', saveReplies.at(-1)?.message_type === 'save_investigation_answer', saveReplies.at(-1));
    await page.locator('#saved-form').getByRole('status').getByText(`Saved as the new investigation “${NAME}”.`).waitFor();
    const saved = saves.at(-1);
    check('saved_with_its_whole_meaning', saved.notes === 'Question: Do resolved cases differ by team?\n\nCounterexample: F04 has no recorded resolution.\n\nLimitation: Seven invented cases.'
      && saved.bookmarks.length === 2 && saved.bookmarks[1].note.startsWith('Role: contrary') && saved.outcome?.counted === 'absence'
      && JSON.stringify(saved.comparison_parent?.retained_predicates) === JSON.stringify([expected.retained]) && saved.comparison?.kind === 'group', saved);
    await writeFile(output, JSON.stringify({checks}));
  } else {
    // After the restart: the saved list says where the finding comes from and that it is not checked yet.
    await areas.getByRole('button', {name: 'Saved', exact: true}).click();
    const table = page.getByRole('table').filter({has: page.getByRole('rowheader', {name: NAME})});
    await table.waitFor();
    const row = table.locator('tbody tr', {has: page.getByRole('rowheader', {name: NAME})});
    const lineage = (await row.textContent()) ?? '';
    check('list_shows_lineage_cutoff_folder_and_unchecked', lineage.includes('source cutoff 2026-12-31 00:00:00 UTC') && lineage.includes('kept in ')
      && lineage.includes('saved ') && lineage.includes('Listed as saved, not checked yet'), lineage);
    check('local_guide_offered', await page.getByText('How saving works').count() === 1, null);
    await page.getByRole('button', {name: `Reopen ${NAME}`, exact: true}).focus();
    await page.keyboard.press('Enter');
    await settled(2);
    const line = (await page.getByRole('region', {name: 'Saved investigation'}).textContent()) ?? '';
    check('notes_reopened_as_written', line.includes('QuestionDo resolved cases differ by team?') && line.includes('CounterexampleF04 has no recorded resolution.')
      && line.includes('2 pinned witnesses saved with it'), line);
    await page.getByRole('button', {name: 'Filters and views'}).click();
    await rail('Pinned').click();
    const index = (await page.getByRole('region', {name: 'Pinned histories'}).textContent()) ?? '';
    check('pins_reopened_with_roles_and_words', index.includes('Supporting · Case F01') && index.includes('Contrary · Case F04') && index.includes('Removed by the selection'), index);
    await areas.getByRole('button', {name: 'Compare', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('.compare-status')?.textContent?.startsWith('Comparison shown'));
    const parent = (await page.getByRole('note', {name: 'Parent'}).textContent()) ?? '';
    check('frozen_parent_reopened_with_its_steps', parent.includes('kept by Keep cases that begin with “Opened”'), parent);
    const outcome = page.getByRole('region', {name: 'Outcome by opening value'});
    await outcome.getByRole('table').waitFor();
    check('outcome_reopened_and_asked_again', ((await outcome.textContent()) ?? '').includes('Outcome O: No recorded “Resolved”'), null);
    // Applied to the refreshed reading: reviewed, saved as a new revision, the earlier one kept.
    await areas.getByRole('button', {name: 'Saved', exact: true}).click();
    const row2 = page.locator('tbody tr', {has: page.getByRole('rowheader', {name: NAME})});
    await row2.getByText('Apply to another reading').click();
    await row2.getByLabel(`Reading to apply ${NAME} to`).selectOption(config.refreshed_preparation_id);
    await row2.getByRole('button', {name: 'Apply, without saving', exact: true}).click();
    const review = page.getByRole('region', {name: 'Applied to another reading, not saved yet'});
    await review.waitFor();
    const items = await review.getByRole('listitem').allTextContents();
    check('refresh_reviewed_before_saving', items.some(item => item.startsWith('Source: changed')) && items.includes('Column roles: unchanged') && items.includes('Clock and cutoff: unchanged')
      && items.some(item => item.startsWith('Selection: changed')) && items.includes('Comparison: to make again on this reading'), items);
    await settled(2);
    check('refreshed_selection_holds_the_new_incident', selections.at(-1).kept.case_ids.includes('F08'), selections.at(-1).kept.case_ids);
    await page.getByRole('button', {name: 'Save', exact: true}).click();
    const form = page.getByRole('region', {name: 'Save a new revision'});
    check('refreshed_save_carries_no_earlier_comparison', ((await form.getByLabel('What this save holds').textContent()) ?? '').includes('Comparisonnone'), null);
    const before = saveReplies.length;
    await form.getByRole('button', {name: 'Save revision', exact: true}).click();
    for (let wait = 0; wait < 600 && saveReplies.length === before; wait += 1) await page.waitForTimeout(100);
    check('refreshed_revision_saved', saveReplies.at(-1)?.message_type === 'save_investigation_answer' && saveReplies.at(-1)?.created_investigation === false, saveReplies.at(-1));
    await page.locator('#saved-form').getByRole('status').getByText(`Saved as a new revision of “${NAME}”.`).waitFor();
    await areas.getByRole('button', {name: 'Saved', exact: true}).click();
    const row3 = page.locator('tbody tr', {has: page.getByRole('rowheader', {name: NAME})});
    await row3.getByText(/^2 revisions/).click();
    const revisions = await row3.locator('.saved-revisions li').allTextContents();
    check('two_revisions_the_earlier_kept', revisions.length === 2 && revisions[0].includes('(latest)') && revisions[1].includes('(earlier: a newer revision exists)'), revisions);
    await row3.getByRole('button', {name: `Reopen revision 1 of ${NAME}`, exact: true}).click();
    await settled(2);
    check('earlier_revision_reopens_as_it_was', !selections.at(-1).kept.case_ids.includes('F08') && selections.at(-1).kept.case_ids.length === 4, selections.at(-1).kept.case_ids);
    await writeFile(output, JSON.stringify({checks}));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
