// The built browser through the selection of whole incidents (#6) of the invented explorer core file: a path is
// highlighted and its step previewed with what it would keep before anything is taken; the step is taken and shown with
// the whole selection's counts, how steps combine and why some incidents are not evaluable; an incident is opened by
// keyboard and the focus returns to it; a second step keeps nothing and says so; undo twice restores exactly the earlier
// identities. Every expectation comes from tests/fixtures/selection-journey/expected.json. Only checks are written.
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
  if (answer) selections.push({preview: answer.request_id.startsWith('preview-'), predicates: answer.predicate_results.map(result => result.predicate), answer});
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const areas = page.getByRole('navigation', {name: 'Areas'});
const count = (n, unit) => `${n} ${n === 1 ? unit : unit + 's'}`;
const {follows, both} = expected;
const sameIds = (support, ids) => JSON.stringify(support.case_ids) === JSON.stringify(ids);
const committed = steps => [...selections].reverse().find(entry => !entry.preview && entry.predicates.length === steps);
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
const view = name => page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name, exact: true});

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  // The invented reading is opened from the Data area, where it was prepared.
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await settled(0);
  const baseIdentity = committed(0).answer.identity;

  // Highlight: a path chosen in the list of paths. Preview: what its step would keep, before anything is taken.
  await view('Paths').click();
  const paths = page.getByRole('table', {name: 'Paths of the kept cases'});
  await paths.getByRole('button', {name: `Path from “${follows.source}” to “${follows.target}”`, exact: true}).click();
  const keepLabel = `Keep cases where “${follows.target}” directly follows “${follows.source}”` + (follows.bridged ? ' in the activity sequence, records without activity label between them passed over' : '');
  const keep = page.getByRole('button', {name: keepLabel, exact: true});
  const previewLine = page.locator(`#${await keep.getAttribute('aria-describedby')}`);
  await previewLine.filter({hasText: /^Preview:/}).waitFor();
  check('preview_counts_match_the_oracle', (await previewLine.textContent()) ===
    `Preview: would keep ${count(follows.kept.length, 'incident')} of ${count(expected.parent, 'incident')}; ${follows.removed.length} removed, ${follows.unevaluable.length} not evaluable. Nothing changes until the step is taken.`,
    await previewLine.textContent());
  check('preview_takes_nothing', !committed(1) && await page.getByRole('list', {name: 'Steps of the selection'}).count() === 0, null);

  // Commit: the chip, the whole selection's counts, how steps combine, and why some are not evaluable.
  await keep.click();
  await settled(1);
  const first = committed(1).answer;
  check('committed_membership_matches_the_oracle', sameIds(first.kept, follows.kept) && sameIds(first.removed, follows.removed) && sameIds(first.unevaluable, follows.unevaluable), first.kept);
  const previewed = selections.find(entry => entry.preview && entry.predicates.length === 1 && JSON.stringify(entry.predicates) === JSON.stringify(committed(1).predicates));
  check('preview_and_commit_share_one_identity', previewed && JSON.stringify(previewed.answer.identity) === JSON.stringify(first.identity), null);
  const steps = (await page.locator('section.selection-steps').textContent()) ?? '';
  check('whole_selection_counted', steps.includes(`All steps together keep ${count(follows.kept.length, 'incident')} of ${count(expected.parent, 'incident')}; ${follows.removed.length} removed, ${follows.unevaluable.length} not evaluable.`), steps);
  check('combination_named', steps.includes('A case is kept only if it meets every step (and).') && steps.includes('or between steps, are not offered'), null);
  check('unevaluable_reason_named', steps.includes('Not evaluable because the order of their records is not known, as a record has no usable time.'), null);

  // Open an incident by keyboard: every record, the unlabelled one included; return puts the focus back on it.
  await view('Cases').click();
  const row = page.locator('table tbody tr button.row-open', {hasText: new RegExp(`^${expected.opened.case}$`)}).first();
  await row.focus();
  await page.keyboard.press('Enter');
  const records = page.getByRole('list', {name: `Records of case ${expected.opened.case} in the declared order`});
  await records.waitFor();
  const items = await records.getByRole('listitem').allTextContents();
  check('opened_incident_has_every_record', items.length === expected.opened.records && items.filter(text => text.includes('no activity label')).length === expected.opened.unlabelled, items.length);
  await page.getByRole('button', {name: 'Return to cases', exact: true}).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(id => document.activeElement?.textContent === id, expected.opened.case);
  check('return_restores_the_focused_incident', true);

  // A second step that keeps nothing: previewed, taken, and said to keep nothing.
  await view('Paths').click();
  await paths.getByRole('button', {name: `Path from “${follows.source}” to “${follows.target}”`, exact: true}).click();
  const never = page.getByRole('button', {name: 'Keep cases where it never does', exact: true});
  const neverPreview = page.locator(`#${await never.getAttribute('aria-describedby')}`);
  await neverPreview.filter({hasText: /^Preview:/}).waitFor();
  check('empty_preview_says_nothing_kept', ((await neverPreview.textContent()) ?? '').startsWith(`Preview: would keep 0 cases of ${count(expected.parent, 'incident')}; ${both.removed.length} removed, ${both.unevaluable.length} not evaluable.`), await neverPreview.textContent());
  await never.click();
  await settled(2);
  const second = committed(2).answer;
  check('empty_selection_matches_the_oracle', sameIds(second.kept, both.kept) && sameIds(second.unevaluable, both.unevaluable), second.kept);
  await view('Cases').click();
  check('empty_selection_says_so', ((await page.locator('main').first().textContent()) ?? '').includes('The selection keeps no case. Remove a step or undo it to keep cases again.'), null);

  // Undo twice: exactly the earlier identities, not merely as many incidents.
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(1);
  check('undo_restores_the_first_identity', JSON.stringify(committed(1).answer.identity) === JSON.stringify(first.identity), null);
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  check('undo_restores_the_parent_identity', JSON.stringify(committed(0).answer.identity) === JSON.stringify(baseIdentity), null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
