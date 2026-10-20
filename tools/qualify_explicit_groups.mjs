// The built browser through two explicitly defined groups (#17) of the fictional groups-and-periods.csv. Two groups
// listed by their incident ids overlap in one incident: their literal memberships, the declared overlap, the sizes and
// the context policy are said, and an incident of a side opens and returns. Within the stratum Priority High the listed
// groups are refused with their recovery; two disjoint condition groups (first recorded with Team A or B) of unequal size
// compare their Service at the first record, the missing value included. Expectations: expected.json and strata.json.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const {groups, strata} = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 900}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], comparisons = [], refusals = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  if (new URL(response.url()).pathname !== '/api/investigations/compare-groups') return;
  const answer = await response.json().catch(() => null);
  if (!answer) return;
  if (response.ok()) comparisons.push(answer); else refusals.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areas = page.getByRole('navigation', {name: 'Areas'});
async function next(list, before) {
  while (list.length === before) await page.waitForTimeout(100);
  return list.at(-1);
}
const slot = letter => page.getByRole('group', {name: `Group ${letter}`});
async function listIds(letter, ids) {
  await slot(letter).getByText(`List incident ids for ${letter}`).click();
  await slot(letter).getByLabel('Incident ids, separated by spaces, commas or new lines').fill(ids.join(' '));
  await slot(letter).getByRole('button', {name: `Use these ids as ${letter}`, exact: true}).click();
}
async function byOpening(letter, column, value) {
  await slot(letter).getByLabel('Incidents that').selectOption('opened');
  await slot(letter).getByLabel(`Column for group ${letter}`).selectOption({label: column});
  await slot(letter).getByLabel(`Value for group ${letter}`).selectOption({label: value});
  await slot(letter).getByRole('button', {name: `Use as ${letter}`, exact: true}).click();
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, groups.parent.case_count);
  await areas.getByRole('button', {name: 'Compare', exact: true}).click();
  await slot('A').waitFor();

  // Two listed groups that overlap, in every incident.
  await listIds('A', groups.explicit_groups.target.case_ids);
  await listIds('B', groups.explicit_groups.reference.case_ids);
  await page.getByLabel('Opening value of').selectOption({label: 'Service'});
  let before = comparisons.length;
  await page.locator('button.compare-primary').click();
  const listed = await next(comparisons, before);
  check('literal_memberships_not_the_rest', same(listed.target.included.case_ids, groups.explicit_groups.target.case_ids) && same(listed.reference.included.case_ids, groups.explicit_groups.reference.case_ids), null);
  const overlap = (await page.getByRole('note', {name: 'Overlap'}).textContent()) ?? '';
  check('overlap_declared', overlap.startsWith('Membership: overlapping. 1 incident with') && overlap.includes('cannot be added'), overlap);
  const said = (await page.locator('.compare-result').textContent()) ?? '';
  const roles = (await page.locator('.compare-roles').textContent()) ?? '';
  const head = (await page.locator('.compare-head').textContent()) ?? '';
  check('definitions_and_parent_said', roles.includes(' A: ') && roles.includes(' B: ') && groups.explicit_groups.target.case_ids.every(id => roles.includes(id))
    && head.includes('the parent is every incident'), [roles, head]);
  check('context_policy_common_to_both', said.includes('The context compared is the value of Service at each incident\'s first record in the declared order (incident.context.first_record_in_declared_order.v1), common to both groups'), said);
  const service = Object.fromEntries(listed.context_profile.categories.map(category => [category.value ?? 'null', [category.target.case_count, category.reference.case_count]]));
  const wantedService = {};
  for (const item of groups.explicit_groups.target.service_counts) wantedService[item.value ?? 'null'] = [item.case_count, 0];
  for (const item of groups.explicit_groups.reference.service_counts) wantedService[item.value ?? 'null'] = [(wantedService[item.value ?? 'null'] ?? [0])[0], item.case_count];
  check('service_counts_with_missing_value', Object.entries(wantedService).every(([value, counts]) => same(service[value], counts)), [service, wantedService]);

  // An incident of a side opens and returns.
  await page.getByRole('group', {name: 'Inspect the incidents of'}).getByRole('button', {name: 'Both', exact: true}).click();
  const both = page.getByRole('list', {name: 'Incidents of A and B'});
  await both.getByRole('button', {name: 'Open G02', exact: true}).click();
  await page.getByRole('region', {name: /^Incident G02, of A/}).getByRole('table').waitFor();
  await page.getByRole('button', {name: 'Return to the comparison', exact: true}).click();
  await page.waitForFunction(() => document.activeElement?.textContent === 'Open G02');
  check('side_incident_opens_and_returns', (await both.getByRole('listitem').allTextContents()).some(item => item.startsWith('G02 · A and B')), null);

  // Within the stratum Priority High: listed groups outside it are refused with their recovery.
  await page.getByLabel('Stratum column').selectOption({label: strata.stratum.column});
  await page.getByLabel('Stratum value').selectOption({label: strata.stratum.value});
  await page.getByRole('button', {name: 'Compare within this stratum', exact: true}).click();
  const parentNote = page.getByRole('note', {name: 'Parent'});
  await parentNote.waitFor();
  check('stratum_is_a_named_parent', ((await parentNote.textContent()) ?? '').includes(`${strata.stratum.case_ids.length} incidents kept by`), await parentNote.textContent());
  before = refusals.length;
  await page.locator('button.compare-primary').click();
  const refused = await next(refusals, before);
  const alert = (await page.getByRole('alert').first().textContent()) ?? '';
  check('listed_groups_outside_the_stratum_refused_with_recovery', refused.code === 'case_outside_parent' && alert.includes('use every incident as the parent'), [refused.code, alert]);

  // Two disjoint condition groups of unequal size, within the stratum.
  await byOpening('A', 'Team', strata.team_groups.target.value);
  await byOpening('B', 'Team', strata.team_groups.reference.value);
  before = comparisons.length;
  await page.locator('button.compare-primary').click();
  const within = await next(comparisons, before);
  const high = strata.within_high;
  check('disjoint_groups_within_the_stratum', same(within.parent.case_ids, strata.stratum.case_ids) && same(within.target.included.case_ids, high.target)
    && same(within.reference.included.case_ids, high.reference) && same(within.pair_support.neither.case_ids, high.neither), [within.target.included, within.reference.included]);
  await page.getByRole('note', {name: 'Overlap'}).getByText(/^Membership: disjoint\./).waitFor();
  check('disjoint_declared', true);
  const sizes = (await page.locator('.compare-result').textContent()) ?? '';
  check('unequal_sizes_visible', sizes.includes('A has 2 incidents and B 1 incident, so their sizes differ'), null);
  const highService = Object.fromEntries(within.context_profile.categories.map(category => [category.value ?? 'not recorded', [category.target.case_count, category.reference.case_count]]).filter(([, counts]) => counts.some(count => count > 0)));
  const sorted = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
  check('stratum_service_with_missing_value', same(sorted(highService), sorted(high.service)), highService);
  check('no_quality_or_cause_wording', sizes.includes('not tests of significance, and no value here is a cause') && (await page.locator('.compare-stratum').textContent()).includes('not the quality of a team, and not a cause'), null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
