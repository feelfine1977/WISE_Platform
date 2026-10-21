// The built browser through the first recorded observation (#7) of the invented explorer core file: the Context
// panel names each value, missing apart from the text Unknown, the incidents without a readable first record, a tie at
// the first record and how it is decided, that the values add up to the incidents counted, and that latest and ever are
// not offered. A missing value and a recorded one are kept by keyboard as steps; the kept incident opens with every
// record and its context changes. Every expectation comes from tests/fixtures/selection-journey/opening-context.json.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const core = config.expected.core;
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
const areas = page.getByRole('navigation', {name: 'Areas'});
const count = (n, unit) => `${n} ${n === 1 ? unit : unit + 's'}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n, steps);
}
const panel = () => page.getByRole('region', {name: 'At the first recorded observation'});
/** Keeps the incidents first recorded with one value: chosen by keyboard, previewed, and applied. */
async function keepValue(value) {
  const box = panel().getByRole('checkbox', {name: `Choose ${value}`, exact: true});
  await box.focus();
  await page.keyboard.press('Space');
  await panel().getByRole('button', {name: 'Preview keeping cases first recorded with these values', exact: true}).click();
  const apply = panel().getByRole('button', {name: 'Apply', exact: true});
  await apply.focus();
  await page.keyboard.press('Enter');
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await settled(0);
  await page.getByRole('button', {name: 'Filters and views'}).click();
  await page.getByRole('group', {name: 'Side panel'}).getByRole('button', {name: 'Context', exact: true}).click();
  await panel().getByRole('list', {name: `Opening values of ${core.column}, most frequent first`}).waitFor();
  const text = (await panel().textContent()) ?? '';
  const values = await panel().getByRole('list', {name: `Opening values of ${core.column}, most frequent first`}).locator('.opening-label').allTextContents();
  const wanted = [...Object.keys(core.values), 'not recorded'];
  check('every_value_named_missing_apart_from_unknown', wanted.every(value => values.includes(value)) && values.length === wanted.length, values);
  check('unreadable_first_records_named', text.includes(`${count(core.unevaluable.length, 'incident')} of the parent has no readable first record because its order is not known`), null);
  check('tie_at_the_first_record_named', text.includes(`${count(core.tied_first_record, 'incident')} of the parent has a first record that shares its time with the next record`)
    && text.includes('the declared order decides which is first, by the sequence number, then by the place in the file'), null);
  check('values_add_up_to_the_incidents_counted', text.includes(`add up to ${count(core.evaluable, 'incident')} of ${count(core.evaluable, 'incident')}`), null);
  check('latest_and_ever_not_offered', text.includes('The latest value and any value ever recorded are not offered here'), null);

  // A missing first value, kept by keyboard: exactly the incidents the oracle names.
  await keepValue('not recorded');
  await settled(1);
  check('missing_kept_as_its_own_value', same(selections.at(-1).kept.case_ids, core.missing) && same(selections.at(-1).unevaluable.case_ids, core.unevaluable), selections.at(-1).kept);
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  // The text Unknown is another value with other incidents.
  await keepValue('Unknown');
  await settled(1);
  check('unknown_kept_apart_from_missing', same(selections.at(-1).kept.case_ids, core.values.Unknown), selections.at(-1).kept);
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  // A recorded value leads to whole incidents and every context change of their records.
  const first = Object.entries(core.values).find(([, ids]) => ids.includes(core.changes_of.case))[0];
  await keepValue(first);
  await settled(1);
  check('recorded_value_kept', same(selections.at(-1).kept.case_ids, core.values[first]), selections.at(-1).kept);
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Cases', exact: true}).click();
  const row = page.locator('table tbody tr button.row-open', {hasText: new RegExp(`^${core.changes_of.case}$`)}).first();
  await row.focus();
  await page.keyboard.press('Enter');
  const list = page.getByRole('list', {name: `Records of case ${core.changes_of.case} in the declared order`});
  await list.waitFor();
  const items = await list.getByRole('listitem').allTextContents();
  const shownContext = items.map(item => { const value = core.changes_of.context.find(v => v !== null && item.includes(v)); return value ?? (item.includes('missing') ? null : '?'); });
  check('every_context_change_shown', same(shownContext, core.changes_of.context), shownContext);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
