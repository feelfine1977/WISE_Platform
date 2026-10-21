// The built browser through the step on the lag of a path (#90) over the invented tests/fixtures/path-lag file: the card
// of the path A to B, selected in the list of paths and on the map, offers the step with the path's median lag as a bound;
// every range of the hand-written expected.json, typed with each bound included or excluded, for one or every passage,
// kept or removed, is previewed, taken as one step whose words name its pair and bounds, keeps the oracle's incidents and
// is undone exactly.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const incidents = 8;
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
const view = name => page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name, exact: true});
const control = () => page.locator('fieldset.path-lag');
const list = () => page.getByRole('table', {name: 'Paths of the kept cases'});
const pathRow = () => list().locator('tbody tr').filter({has: page.locator('th', {hasText: new RegExp(`^${expected.source}$`)})}).filter({has: page.locator('td', {hasText: new RegExp(`^${expected.target}$`)})}).first();
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
async function selectInList() {
  await view('Paths').click();
  await list().waitFor();
  if (await pathRow().locator('th button').getAttribute('aria-pressed') !== 'true') await pathRow().locator('th button').click();
  await control().waitFor();
}
const hoursText = hours => (hours >= 48 && hours % 24 === 0 ? `${hours} hours (${hours / 24} days)` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`);
function words(range) {
  const pair = `from “${expected.source}” to “${expected.target}”`;
  const low = range.minimum_hours === null ? null : `${range.minimum_inclusive ? 'at least' : 'more than'} ${hoursText(range.minimum_hours)}`;
  const high = range.maximum_hours === null ? null : `${range.maximum_inclusive ? 'at most' : 'less than'} ${hoursText(range.maximum_hours)}`;
  const bounds = [low, high].filter(Boolean).join(' and ');
  if (range.passages === 'every') return range.negate ? `Keep cases that never pass ${pair}, or have a passage of it that does not take ${bounds}` : `Keep cases that pass ${pair} with every passage taking ${bounds}`;
  return range.negate ? `Keep cases with no passage ${pair} taking ${bounds}` : `Keep cases with at least one passage ${pair} taking ${bounds}`;
}
/** Takes the previewed step, checks its words, its preview and its incidents against the oracle, and undoes it. */
async function takeAndCheck(name, range) {
  const pending = page.getByRole('group', {name: 'Lag step not yet taken'});
  await pending.waitFor();
  check(`${name}_words`, (await pending.locator('p').first().textContent()) === words(range), await pending.locator('p').first().textContent());
  await page.waitForFunction(() => /^Preview: would keep/.test(document.querySelector('[aria-label="Lag step not yet taken"] .step-preview')?.textContent ?? ''));
  const previewed = await pending.locator('.step-preview').textContent();
  const kept = range.kept.length;
  check(`${name}_previewed`, previewed.startsWith(`Preview: would keep ${kept} case${kept === 1 ? '' : 's'} of ${incidents} cases; ${range.removed.length} removed, ${range.unevaluable.length} not evaluable.`), previewed);
  await pending.getByRole('button', {name: 'Take this step', exact: true}).click();
  await settled(1);
  const taken = selections.at(-1);
  check(`${name}_kept_as_the_oracle`, same(taken.kept.case_ids, range.kept) && same(taken.unevaluable.case_ids, range.unevaluable)
    && taken.predicate_results.length === 1 && taken.predicate_results[0].predicate.kind === 'path_lag_in_range', [taken.kept.case_ids, taken.unevaluable.case_ids]);
  const chip = await page.getByRole('list', {name: 'Steps of the selection'}).locator('li').first().textContent();
  check(`${name}_step_reads_its_pair_and_bounds`, chip.includes(words(range)), chip);
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  check(`${name}_undone_exactly`, same(selections.at(-1).identity, parentIdentity), null);
}
let parentIdentity = null;

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, incidents);
  await settled(0);
  parentIdentity = selections.at(-1).identity;

  // From the row of the list of paths: the median lag offered as a bound.
  await selectInList();
  check('row_card_offers_the_step_with_the_median_lag', (await control().textContent()).includes(`the path's median lag is ${hoursText(expected.path.median_lag_hours)}`), await control().textContent());
  await control().getByRole('button', {name: 'Slower than the median lag', exact: true}).click();
  check('median_taken_as_the_lower_bound', await control().getByLabel('Lower bound (hours; empty for none)').inputValue() === String(expected.path.median_lag_hours), null);
  await control().getByRole('button', {name: 'Keep by this lag', exact: true}).click();
  await takeAndCheck('median_preset', expected.ranges.find(range => range.name === 'slower_than_30_days'));

  // Every range of the oracle, typed in the card of the row.
  for (const range of expected.ranges) {
    await selectInList();
    const set = async (label, value) => control().getByLabel(label).fill(value === null ? '' : String(value));
    await control().getByLabel('Unit').selectOption('hours');
    await set('Lower bound (hours; empty for none)', range.minimum_hours);
    await set('Upper bound (hours; empty for none)', range.maximum_hours);
    for (const [label, wanted] of [['Lower bound included', range.minimum_inclusive], ['Upper bound included', range.maximum_inclusive], [/^Every passage of a case in the range/, range.passages === 'every']]) {
      const box = control().getByLabel(label);
      if (await box.isChecked() !== wanted && !(wanted === false && (label === 'Lower bound included' ? range.minimum_hours === null : label === 'Upper bound included' && range.maximum_hours === null))) await box.click();
    }
    await control().getByRole('button', {name: range.negate ? 'Remove by this lag' : 'Keep by this lag', exact: true}).click();
    await takeAndCheck(range.name, range);
  }

  // On the map: the path drawn and selected there, its card offers the same step; typed in days.
  await selectInList();
  const draw = page.getByRole('button', {name: /^(Draw|Show) on the map$/});
  await draw.click();
  await page.waitForFunction(() => document.querySelector('[aria-label="View"] button[aria-pressed="true"]')?.textContent === 'Map');
  await control().waitFor();
  check('map_card_offers_the_step', await control().getByRole('button', {name: 'Keep by this lag', exact: true}).count() === 1, null);
  await control().getByLabel('Unit').selectOption('days');
  await control().getByLabel('Lower bound (days; empty for none)').fill('30');
  if (await control().getByLabel('Lower bound included').isChecked()) await control().getByLabel('Lower bound included').click();
  await control().getByRole('button', {name: 'Keep by this lag', exact: true}).click();
  await takeAndCheck('map_days', expected.ranges.find(range => range.name === 'slower_than_30_days'));
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
