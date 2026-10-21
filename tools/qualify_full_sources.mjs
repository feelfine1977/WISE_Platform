// The built browser over a reopened investigation: its population, profile, evidence and saved score views.
// Each view's start and end are reported in wall-clock seconds, so the caller can attribute the browser's
// sampled memory to it. Only counts, identities and digests are written out, never record contents.
//
// Phase "review" checks the expected texts, opens witness evidence, saves a revision through the browser and
// downloads both exports. Phase "reopen", run against a new service process, reopens that revision and
// downloads the exports again, so the caller can require identical bytes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, workspace, savedName, caseId, output, playwright, chrome, phase = 'review', expectedPath = ''] = process.argv.slice(2);
const expected = expectedPath ? JSON.parse(await readFile(expectedPath, 'utf8')) : {texts: [], witness_states: []};
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
const timeout = Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 300000);
page.setDefaultTimeout(timeout);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
// Every service request the page makes, by route and time only; WISE_BROWSER_REQUEST_LOG names a file to keep them in.
const requestLog = [];
let inFlight = 0;
const route = request => new URL(request.url()).pathname;
page.on('request', request => { if (route(request).startsWith('/api/')) inFlight++, requestLog.push([Date.now() / 1000, 'start', request.method(), route(request)]); });
page.on('requestfinished', request => { if (route(request).startsWith('/api/')) inFlight--, requestLog.push([Date.now() / 1000, 'end', request.method(), route(request)]); });
page.on('requestfailed', request => { if (route(request).startsWith('/api/')) inFlight--, requestLog.push([Date.now() / 1000, 'failed', request.method(), route(request)]); });
const areas = page.getByRole('navigation', {name: 'Areas'});
const profileRegion = page.getByRole('region', {name: 'Understand the purchasing flows', exact: true});
const views = {}, downloads = [], witnesses = [], inspections = [], retained = [];
const main = page.locator('main.bpic19-workspace');

async function view(name, action) {
  const start = Date.now() / 1000;
  await action();
  views[name] = {start, end: Date.now() / 1000};
}

// Only the status is read: a full population's replies run to tens of megabytes, more than the browser keeps
// for inspection. The service journey has already checked their contents over HTTP.
async function answered(route, action) {
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(route) && response.request().method() === 'POST'), action()]);
  assert.equal(response.status(), 200, route);
}

// A view is settled when none of its requests is in flight for a second. Acting earlier races the
// application: a control enabled now may be disabled by the answer still arriving, and a click on it is lost.
async function settled() {
  const deadline = Date.now() + timeout;
  for (let quiet = 0; quiet < 10; quiet = inFlight === 0 ? quiet + 1 : 0) {
    if (Date.now() > deadline) throw new Error(`the view did not settle within ${timeout} ms`);
    await page.waitForTimeout(100);
  }
}

async function openSourceReview() {
  // The reviewed source sits in a collapsed section, rendered once the reopened profile arrives; open it as the
  // analyst would, without toggling it closed.
  if (!expected.witness_states.length && !expected.texts.some(text => text.startsWith('Raw parsed range'))) return;
  await profileRegion.getByText('Source scope and observation review ·', {exact: false}).first().waitFor({state: 'attached'});
  await profileRegion.locator('details').evaluateAll(sections => sections
    .filter(section => section.querySelector(':scope > summary')?.textContent.startsWith('Source scope and observation review ·'))
    .forEach(section => { section.open = true; }));
}

async function showProfile() {
  await areas.getByRole('button', {name: 'Purchasing analysis', exact: true}).click();
  await profileRegion.waitFor();
  await page.waitForLoadState('networkidle');
  await openSourceReview();
  for (const text of expected.texts) await profileRegion.getByText(text, {exact: false}).first().waitFor();
  await settled();
}

// The saved native paper run, as the reopened purchasing view shows it: its summary and the named group rows.
async function showScore() {
  const wanted = [expected.score.summary, ...expected.score.groups.map(group => group.row)];
  const deadline = Date.now() + timeout;
  for (;;) {
    const shown = (await main.textContent()) ?? '';
    const missing = wanted.filter(text => !shown.includes(text));
    if (!missing.length) break;
    if (Date.now() > deadline) throw new Error(`score texts missing: ${missing.length} of ${wanted.length}`);
    await page.waitForTimeout(500);
  }
  await settled();
}

// Each named group's stored members, one member's complete records, and the group's timing exemplar's records.
async function inspectScore() {
  for (const group of expected.score.groups) {
    await answered('/api/investigations/bpic19-read', () => main.getByRole('button', {name: 'Inspect members of ' + group.label, exact: true}).click());
    await main.getByText(`of ${group.members}`, {exact: false}).first().waitFor();
    await settled();
    await answered('/api/investigations/case-evidence', () => main.getByRole('button', {name: 'Inspect records', exact: true}).first().click());
    await page.getByRole('heading', {name: /^Incident /}).first().waitFor();
    const entry = {group: group.label, members_opened: true, member_records_opened: true, exemplar_records_opened: false};
    await answered('/api/investigations/bpic19-read', () => main.getByRole('button', {name: 'Show all assessed items', exact: true}).click());
    await settled();
    if (group.exemplar) {
      const paragraph = main.locator('p', {hasText: group.exemplar + ' · all-evaluable median'}).first();
      await answered('/api/investigations/case-evidence', () => paragraph.getByRole('button', {name: 'Inspect timing exemplar', exact: true}).click());
      await page.getByRole('heading', {name: 'Incident ' + group.exemplar, exact: true}).waitFor();
      entry.exemplar_records_opened = true;
    }
    inspections.push(entry);
  }
}

// Each saved historical view's own run, read back as a retained assessment; in review, one member's records are opened.
async function readRetained(openRecords) {
  const section = main.locator('details', {hasText: 'Retained native assessments'}).first();
  await section.evaluate(details => { details.open = true; });
  const choice = section.getByRole('combobox', {name: 'Retained assessment', exact: true});
  for (const view of expected.historical) {
    await answered('/api/investigations/bpic19-read', () => choice.selectOption({label: view.label}));
    await section.getByText(view.summary, {exact: false}).first().waitFor();
    const entry = {label: view.label, summary_shown: true, records_opened: false};
    if (openRecords) {
      await answered('/api/investigations/case-evidence', () => section.getByRole('button', {name: 'Inspect records', exact: true}).first().click());
      entry.records_opened = true;
    }
    await section.getByRole('button', {name: 'Close retained assessment', exact: true}).click();
    retained.push(entry);
  }
  await settled();
}

async function exportAll() {
  for (const [kind, label] of [['json', 'Export saved definitions, results and witnesses'], ['md', 'Export readable purchasing analysis report']]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', {name: label, exact: true}).click()]);
    const path = `${output}.${phase}.${kind}`;
    await download.saveAs(path);
    const bytes = await readFile(path);
    const entry = {kind, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
    if (kind === 'json') entry.saved_revision_id = JSON.parse(bytes.toString()).revision.saved_revision_id;
    downloads.push(entry);
  }
}

const incident = () => page.getByRole('button', {name: caseId, exact: true}).first();

try {
  await view('population', async () => {
    await page.goto(base);
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    await page.getByText('Use another folder', {exact: true}).click();
    await page.getByLabel('Folder path').fill(workspace);
    await answered('/api/workspaces/open', () => page.getByRole('button', {name: 'Open workspace', exact: true}).click());
    await areas.getByRole('button', {name: 'Saved', exact: true}).click();
    await answered('/api/investigations/reopen', () => page.getByRole('button', {name: 'Reopen ' + savedName, exact: true}).click());
    await areas.getByRole('button', {name: 'Investigations', exact: true}).click();
    await incident().waitFor();
  });
  await view('profile', showProfile);
  if (expected.score) await view('score', showScore);
  if (phase === 'review' && expected.score) await view('score_evidence', inspectScore);
  if (expected.historical) await view('historical', () => readRetained(phase === 'review'));
  if (phase === 'review') {
    await view('evidence', async () => {
      await areas.getByRole('button', {name: 'Investigations', exact: true}).click();
      await answered('/api/investigations/case-evidence', () => incident().click());
      await page.getByRole('heading', {name: 'Incident ' + caseId, exact: true}).waitFor();
    });
    for (const state of expected.witness_states) {
      await showProfile();
      await profileRegion.getByText(state.replaceAll('_', ' ') + ':', {exact: false}).first().click();
      const witness = profileRegion.getByRole('button', {name: /^Inspect timestamp witness /}).first();
      const witnessCase = (await witness.textContent()).replace('Inspect timestamp witness ', '').trim();
      await answered('/api/investigations/case-evidence', () => witness.click());
      await page.getByRole('heading', {name: 'Incident ' + witnessCase, exact: true}).waitFor();
      witnesses.push({state, opened: true});
    }
    await showProfile();
    await page.locator('#bpic19-save-wait').waitFor({state: 'detached'});
    await page.getByRole('button', {name: 'Save', exact: true}).first().click();
    await page.getByRole('heading', {name: 'Save a new revision', exact: true}).waitFor();
    await answered('/api/investigations/save', () => page.getByRole('button', {name: 'Save revision', exact: true}).click());
    await page.getByRole('button', {name: 'Close', exact: true}).click();
  }
  await exportAll();
  assert.deepEqual(errors, []);
  for (const name of Object.keys(views)) views[name].phase = phase;
  await writeFile(output, JSON.stringify({views, downloads, witnesses, inspections, retained}));
} catch (error) {
  // Interface state only: the save form's texts and the save controls' states, never record contents.
  const state = await page.evaluate(() => ({
    form: document.querySelector('#saved-form')?.innerText ?? null,
    wait: document.querySelector('#bpic19-save-wait')?.innerText ?? null,
    buttons: [...document.querySelectorAll('button')].filter(b => /^(Save|Save revision|Close)$/.test(b.textContent.trim()))
      .map(b => ({name: b.textContent.trim(), disabled: b.disabled})),
    nameFilled: (document.querySelector('#saved-form input[type=text]')?.value ?? '').trim() !== '',
  })).catch(reason => ({unavailable: String(reason)}));
  console.error('interface state at failure', JSON.stringify(state));
  throw error;
} finally {
  if (process.env.WISE_BROWSER_REQUEST_LOG) await writeFile(process.env.WISE_BROWSER_REQUEST_LOG, JSON.stringify(requestLog));
  await browser.close();
}
