// The built browser through the longest recorded gaps (#61) over the invented tests/fixtures/gap-pairs file: a step keeps
// the incidents of at least ten hours; the Gaps panel lists each pair with its kept and parent incidents, passages, median
// and 90th percentile as the hand-written expected.json says, the longest 90th percentile first, the unlabelled endpoint
// named and the incidents of unknown order said; a pair orders the incident list by its longest gap without a step; a
// path of the map gives its 90th percentile lag and the passages longer than a threshold.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 900}});
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
const view = name => page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name, exact: true});
const label = activity => activity ?? '(no activity label)';
const number = value => value === null ? '–' : new Intl.NumberFormat('en', {maximumFractionDigits: 1}).format(value);
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
async function rail(name) {
  if (!(await page.getByRole('group', {name: 'Side panel'}).isVisible().catch(() => false))) await page.getByRole('button', {name: 'Filters and views'}).click();
  await page.getByRole('group', {name: 'Side panel'}).getByRole('button', {name, exact: true}).click();
}
const table = () => page.getByRole('table', {name: 'Pairs with their recorded gaps, the longest 90th percentile first'});

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await page.getByRole('navigation', {name: 'Areas'}).getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length === 8);
  await settled(0);
  // The kept incidents: a span of at least ten hours.
  await rail('Filters');
  const time = page.locator('details', {has: page.getByText('Recorded time', {exact: true})});
  await time.locator('summary').click();
  await time.getByLabel('Measure').selectOption('observed_span_at_least');
  await time.getByLabel('At least this many hours').fill(String(expected.kept_step.hours));
  await time.getByRole('button', {name: 'Keep by recorded time', exact: true}).click();
  await page.getByRole('group', {name: 'Filter not yet taken'}).getByRole('button', {name: 'Take this step', exact: true}).click();
  await settled(1);
  const keptSelection = selections.at(-1);
  const asked = selections.length;

  // The pairs, kept against the parent, the longest 90th percentile first.
  await rail('Gaps');
  await table().waitFor();
  const rows = await table().locator('tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(cell => cell.textContent)));
  const order = rows.map(cells => cells[0]);
  check('pairs_in_order_of_the_kept_90th_percentile', same(order, expected.raw_adjacent.order.map(([from, to]) => `${label(from)} → ${label(to)}`)), order);
  const byName = Object.fromEntries(rows.map(cells => [cells[0].replace(' → ', '>').replaceAll('(no activity label)', '(no label)'), cells]));
  for (const [pair, wanted] of Object.entries(expected.raw_adjacent.pairs)) {
    const cells = byName[pair];
    const kept = wanted.kept;
    check(`${pair}_kept_figures`, cells[1].startsWith(String(kept.incident_count)) && cells[2] === String(kept.passage_count) && cells[3] === number(kept.median_hours)
      && cells[4] === number(kept.p90_hours) && cells[5] === `${kept.above_threshold_passage_count} in ${kept.above_threshold_incident_count}`, cells);
    if (wanted.parent) {
      const parent = wanted.parent;
      check(`${pair}_parent_figures`, cells[6].startsWith(String(parent.incident_count)) && cells[7] === String(parent.passage_count) && cells[8] === number(parent.median_hours) && cells[9] === number(parent.p90_hours), cells);
    }
  }
  const panelText = await page.locator('section.gap-pairs').textContent();
  check('policies_and_unknown_order_said', panelText.includes('each passage of a pair counts once') && panelText.includes('the 90th percentile is the passage at the nearest rank')
    && panelText.includes(`(parent ${expected.groups.parent.order_unknown_case_count}) whose order of records is not known`), null);
  check('no_working_or_waiting_time', panelText.includes('It is not a working or a waiting time'), null);

  // A pair orders the incident list by its longest gap; no step is taken.
  const [from, to] = expected.chosen.pair;
  await table().getByRole('button', {name: `${label(from)} → ${label(to)}`, exact: true}).click();
  await page.waitForFunction(n => document.querySelectorAll('.incident-table table tbody tr button.row-open').length === n, expected.chosen.cases.length);
  const listed = await page.locator('.incident-table table tbody tr button.row-open').allTextContents();
  check('pair_orders_the_incident_list_by_its_longest_gap', same(listed, expected.chosen.cases.map(([caseId]) => caseId)), listed);
  check('ordering_takes_no_step', selections.length === asked && same(selections.at(-1).identity, keptSelection.identity)
    && (await page.locator('.view-note').textContent()).includes('This is an order of the list: the selection and every count stay as they are'), selections.length);

  // A path of the map: its 90th percentile lag and its passages longer than the threshold, along the map's paths.
  await page.getByRole('button', {name: 'Show every incident', exact: true}).click();
  await view('Paths').click();
  const list = page.getByRole('table', {name: 'Paths of the kept incidents'});
  await list.locator('tbody tr').filter({has: page.locator('th', {hasText: /^Assign$/})}).filter({has: page.locator('td', {hasText: /^Resolve$/})}).first().locator('th button').click();
  const mapped = expected.mapped_path.pairs['Assign>Resolve'].kept;
  const card = page.getByRole('group', {name: 'Long lags of this path'});
  await card.getByText(/^90th percentile lag/).waitFor();
  const cardText = await card.locator('p').first().textContent();
  check('path_gives_its_90th_percentile_and_long_passages', cardText.startsWith(`90th percentile lag ${number(mapped.p90_hours)} h over ${mapped.passage_count} passages; ${mapped.above_threshold_passage_count} passages are longer than ${expected.threshold_hours} h, in ${mapped.above_threshold_incident_count} incidents.`), cardText);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
