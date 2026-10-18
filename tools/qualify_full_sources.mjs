// The built browser over a reopened investigation: its population, profile and evidence views.
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
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 300000));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const areas = page.getByRole('navigation', {name: 'Areas'});
const profileRegion = page.getByRole('region', {name: 'Understand the purchasing flows', exact: true});
const views = {}, downloads = [], witnesses = [];

async function view(name, action) {
  const start = Date.now() / 1000;
  await action();
  views[name] = {start, end: Date.now() / 1000};
}

// Only the status is read: a full population's replies run to tens of megabytes, more than the browser keeps
// for inspection. The service journey has already checked their contents over HTTP.
async function answered(route, action) {
  const pending = page.waitForResponse(response => response.url().endsWith(route) && response.request().method() === 'POST');
  await action();
  const response = await pending;
  assert.equal(response.status(), 200, route);
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
}

async function exportAll() {
  for (const [kind, label] of [['json', 'Export saved definitions, results and witnesses'], ['md', 'Export readable purchasing analysis report']]) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', {name: label, exact: true}).click();
    const download = await pending;
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
    await page.getByRole('button', {name: 'Save', exact: true}).first().click();
    await answered('/api/investigations/save', () => page.getByRole('button', {name: 'Save revision', exact: true}).click());
    await page.getByRole('button', {name: 'Close', exact: true}).click();
  }
  await exportAll();
  assert.deepEqual(errors, []);
  for (const name of Object.keys(views)) views[name].phase = phase;
  await writeFile(output, JSON.stringify({views, downloads, witnesses}));
} finally {
  await browser.close();
}
