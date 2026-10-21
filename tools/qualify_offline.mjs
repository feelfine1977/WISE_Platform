// The built browser through a local investigation with networking unavailable (#27). The browser resolves no host but
// this computer's and every request elsewhere is refused and recorded; the service runs under a guard that refuses and
// records every connection that is not to this computer.
// - "offline": the invented tests/fixtures/requests file is imported through the Data area, a step is taken, the map, the
//   paths, the matrix, the variants, the context and the times are shown, a complete history is opened, the investigation
//   is saved, and the workspace is backed up after a preview that names the local folder and what it holds;
// - "reopen", after an actual restart: the saved investigation reopens with its step and the same incidents;
// - "unavailable", after a restart without the method library: scoring an expectation is refused in words, with how to
//   install it, and no result is shown; everything else still works.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath, phase] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const NAME = 'Invented offline investigation';
const {chromium} = await import(pathToFileURL(playwright).href);
// No host but this computer's resolves: networking is unavailable to the browser.
const browser = await chromium.launch({headless: true, executablePath: chrome, args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const context = await browser.newContext({viewport: {width: 1366, height: 768}});
const origin = new URL(base).origin;
const requests = [], refused = [];
await context.route('**/*', route => {
  const url = route.request().url();
  if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  refused.push(new URL(url).host);
  return route.abort('internetdisconnected');
});
const page = await context.newPage();
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push({method: request.method(), url: request.url()}));
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
const ISO = 'Year-Month-Day, ISO 8601';

async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
async function role(label, column) {
  const select = page.getByLabel(label, {exact: true});
  const value = await select.evaluate((element, name) => [...element.options].find(option => option.text.startsWith(`${name} — `))?.value, column);
  assert.ok(value !== undefined, `${label}: no option for ${column}`);
  await select.selectOption(value);
}
/** What the browser asked, without identities or values: the method and the path, with every request's host. */
function privacy() {
  const paths = {};
  for (const {method, url} of requests) {
    const {pathname} = new URL(url);
    const key = `${method} ${pathname.startsWith('/assets/') ? '/assets/*' : pathname}`;
    paths[key] = (paths[key] ?? 0) + 1;
  }
  return {request_count: requests.length, hosts: [...new Set(requests.map(({url}) => new URL(url).host.replace(/:\d+$/, ':<port>')))], refused_hosts: [...new Set(refused)], by_path: paths};
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0 || !!document.querySelector('[aria-label="Add an event-history CSV"]'));
  if (phase === 'offline') {
    // ---- import a synthetic local file through the Data area ----
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    await page.getByLabel('Add an event-history CSV').setInputFiles(config.file);
    await page.getByLabel('Case id', {exact: true}).waitFor();
    await role('Case id', 'Ticket');
    await role('Activity', 'Status');
    await role('Time', 'At');
    await role('Sequence number (optional)', 'Seq');
    await page.getByRole('radio', {name: new RegExp(`^${ISO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)}).check();
    await page.getByRole('radio', {name: 'Offsets written in the values, for example Z or +02:00'}).check();
    await page.getByRole('status').filter({hasText: /^Proposed from the data:/}).waitFor();
    const use = page.getByRole('button', {name: 'Use the proposal', exact: true});
    if (await use.count()) await use.click();
    await page.getByRole('button', {name: 'Read the source with these choices', exact: true}).click();
    await page.getByRole('region', {name: 'What WISE understood'}).waitFor();
    const issues = page.getByRole('checkbox', {name: 'I have read the rows with issues; keep them as described above.'});
    if (await issues.count()) await issues.check();
    await page.getByRole('button', {name: 'Confirm and prepare', exact: true}).click();
    await page.getByRole('status').filter({hasText: 'Ready: the source is read with these choices'}).waitFor();
    await page.getByRole('button', {name: 'Open cases', exact: true}).click();
    await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, expected.incidents.length);
    await settled(0);
    check('imported_offline', selections.at(-1).kept.case_count === expected.incidents.length, selections.at(-1).kept.case_count);

    // ---- query, map, paths, matrix, variants, context, times and evidence ----
    await view('Map').click();
    await page.getByLabel('Process map of the kept cases').waitFor();
    await page.locator('.map-aside').getByText('Cases by recorded span').waitFor();
    check('map_and_times_shown', await page.locator('.map-legend .wf-legend').count() === 1, null);
    await view('Paths').click();
    await page.getByRole('table', {name: 'Paths of the kept cases'}).waitFor();
    await page.getByRole('table', {name: 'Paths of the kept cases'}).getByRole('button', {name: 'Path from “Opened” to “Asked customer”', exact: true}).click();
    await page.getByRole('button', {name: 'Keep cases where “Asked customer” directly follows “Opened”', exact: true}).click();
    await settled(1);
    const kept = selections.at(-1);
    check('step_taken_offline', same(kept.kept.case_ids, config.kept_after_step), kept.kept.case_ids);
    await view('Matrix').click();
    await page.locator('.matrix-pane table').first().waitFor();
    await view('Variants').click();
    await page.getByRole('list', {name: 'Variants, most cases first'}).waitFor();
    await page.getByRole('button', {name: 'Filters and views', exact: true}).click();
    await page.getByRole('heading', {name: 'At the first recorded observation'}).waitFor();
    check('matrix_variants_and_context_shown', true);
    await view('Cases').click();
    const first = config.kept_after_step[0];
    const [evidence] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/case-evidence'),
      page.getByRole('table', {name: 'Kept cases'}).getByRole('button', {name: first, exact: true}).click()]);
    await page.getByRole('heading', {name: `Case ${first}`}).waitFor();
    check('complete_history_offline', (await evidence.json()).records.length === await page.locator('ol.history > li').count(), null);
    await page.keyboard.press('Escape');

    // ---- saved, then backed up after a preview of where and what ----
    await page.getByRole('button', {name: 'Save', exact: true}).click();
    const form = page.getByRole('region', {name: 'Save this investigation'});
    await form.getByLabel('Name').fill(NAME);
    await form.getByRole('button', {name: 'Save', exact: true}).click();
    await page.locator('#saved-form').getByRole('status').getByText(`Saved as the new investigation “${NAME}”.`).waitFor();
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    await page.getByText('Back up or restore', {exact: true}).click();
    await page.getByLabel(/^Backup folder/).fill(config.backup);
    check('backup_not_written_before_its_preview', await page.getByRole('button', {name: 'Back up this workspace'}).isDisabled(), null);
    await page.getByRole('button', {name: 'Preview the backup', exact: true}).click();
    const preview = page.locator('.backup-preview');
    await preview.getByText(/a folder of this computer, would hold/).waitFor();
    const said = (await preview.textContent()) ?? '';
    check('backup_preview_names_the_local_folder_and_content', said.includes('a folder of this computer') && said.includes('1 saved investigation') && said.includes('nothing is sent over a network'), said.replace(config.backup, '<backup folder>'));
    await page.getByRole('button', {name: 'Back up this workspace', exact: true}).click();
    await page.getByText(/^Backed up into /).waitFor();
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks, privacy: privacy(), kept_identity: kept.identity}));
  } else if (phase === 'reopen') {
    await areas.getByRole('button', {name: 'Saved', exact: true}).click();
    await page.getByRole('button', {name: `Reopen ${NAME}`, exact: true}).click();
    await page.getByRole('list', {name: 'Steps of the selection'}).waitFor();
    await settled(1);
    check('saved_investigation_reopened_offline', same(selections.at(-1).identity, config.kept_identity) && same(selections.at(-1).kept.case_ids, config.kept_after_step), selections.at(-1).kept.case_ids);
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks, privacy: privacy()}));
  } else {
    // ---- without the method library: an honest refusal, never a result ----
    await areas.getByRole('button', {name: 'Saved', exact: true}).click();
    await page.getByRole('button', {name: `Reopen ${NAME}`, exact: true}).click();
    await settled(1);
    await areas.getByRole('button', {name: 'Expectation', exact: true}).click();
    const form = page.locator('form.expectation-form');
    await form.getByLabel('Start activity').selectOption('Asked customer');
    await form.getByLabel('Response activity').selectOption('Customer replied');
    await form.getByLabel('Target (hours)').fill('24');
    await form.getByLabel('Width (hours partly met after the target)').fill('24');
    await form.getByRole('radio', {name: 'Counted as not met'}).check();
    await form.getByLabel('Name').fill('Offline expectation');
    await form.getByLabel('Owner').fill('Invented desk');
    await form.getByLabel('Source (for example a service agreement)').fill('Invented agreement');
    await form.getByLabel('Rationale').fill('Synthetic.');
    await form.getByRole('checkbox', {name: /I have reviewed this definition/}).check();
    await form.getByRole('button', {name: 'Check the definition', exact: true}).click();
    await page.getByText(/The method library wise-pm, which scores expectations, is not installed/).first().waitFor();
    check('unavailable_method_refused_in_words', ((await page.locator('.expectation').textContent()) ?? '').includes('Everything else works without it.')
      && await page.locator('.expectation-states').count() === 0, null);
    await areas.getByRole('button', {name: 'Investigations', exact: true}).click();
    await view('Map').click();
    await page.getByLabel('Process map of the kept cases').waitFor();
    check('everything_else_works_without_it', true);
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({checks, privacy: privacy()}));
  }
} finally {
  await browser.close();
}
