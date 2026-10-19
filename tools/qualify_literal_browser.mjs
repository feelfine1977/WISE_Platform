// The built browser over a saved investigation of a literal fixture: reopen it, let the purchasing view
// request its saved actions again, check the expected texts and download both exports.
// Run twice by qualify_literal_browser.py, around an actual service restart. In the review phase the analyst saves
// a revision of what the view shows (its own default actions included) before exporting; the reopen phase exports
// that revision again.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, workspace, savedName, output, playwright, chrome, expectedPath, phase = 'review'] = process.argv.slice(2);
const expected = JSON.parse(await readFile(expectedPath, 'utf8'));
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
const timeout = Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000);
page.setDefaultTimeout(timeout);
const errors = [], requests = [];
let inFlight = 0;
page.on('pageerror', error => errors.push(error.message));
const route = request => new URL(request.url()).pathname;
page.on('request', request => { if (route(request).startsWith('/api/')) { inFlight++; requests.push(route(request)); } });
page.on('requestfinished', request => { if (route(request).startsWith('/api/')) inFlight--; });
page.on('requestfailed', request => { if (route(request).startsWith('/api/')) inFlight--; });
const areas = page.getByRole('navigation', {name: 'Areas'});

async function settled() {
  const deadline = Date.now() + timeout;
  for (let quiet = 0; quiet < 10; quiet = inFlight === 0 ? quiet + 1 : 0) {
    if (Date.now() > deadline) throw new Error(`the view did not settle within ${timeout} ms`);
    await page.waitForTimeout(100);
  }
}

async function answered(path, action) {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST'), action()]);
  assert.equal(response.status(), 200, path);
}

const downloads = [];
try {
  await page.goto(base);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByText('Use another folder', {exact: true}).click();
  await page.getByLabel('Folder path').fill(workspace);
  await answered('/api/workspaces/open', () => page.getByRole('button', {name: 'Open workspace', exact: true}).click());
  await areas.getByRole('button', {name: 'Saved', exact: true}).click();
  await answered('/api/investigations/reopen', () => page.getByRole('button', {name: 'Reopen ' + savedName, exact: true}).click());
  await areas.getByRole('button', {name: 'Purchasing analysis', exact: true}).click();
  const workspaceView = page.locator('main.bpic19-workspace');
  await workspaceView.waitFor();
  await settled();
  // Texts may sit in collapsed sections; they are in the page as the analyst can expand them.
  const shown = await workspaceView.textContent();
  // Authoring aid for synthetic literals only: WISE_BROWSER_DUMP_TEXT names a file to keep the view's text in.
  if (process.env.WISE_BROWSER_DUMP_TEXT) await writeFile(process.env.WISE_BROWSER_DUMP_TEXT, shown);
  const missing = expected.texts.filter(text => !shown.includes(text));
  assert.deepEqual(missing, [], 'expected texts missing from the purchasing view');
  if (phase === 'review') {
    await page.locator('#bpic19-save-wait').waitFor({state: 'detached'});
    await page.getByRole('button', {name: 'Save', exact: true}).first().click();
    await page.getByRole('heading', {name: 'Save a new revision', exact: true}).waitFor();
    await answered('/api/investigations/save', () => page.getByRole('button', {name: 'Save revision', exact: true}).click());
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    await settled();
  }
  for (const [kind, label] of [['json', 'Export saved definitions, results and witnesses'], ['md', 'Export readable purchasing analysis report']]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', {name: label, exact: true}).click()]);
    const path = `${output}.${kind}`;
    await download.saveAs(path);
    const bytes = await readFile(path);
    downloads.push({kind, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  }
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({downloads, texts: expected.texts.length, requests: [...new Set(requests)].sort()}));
} catch (error) {
  const state = await page.evaluate(() => ({
    alerts: [...document.querySelectorAll('[role=alert]')].map(alert => alert.textContent.slice(0, 300)),
    status: [...document.querySelectorAll('[role=status]')].map(status => status.textContent.slice(0, 300)),
  })).catch(reason => ({unavailable: String(reason)}));
  console.error('interface state at failure', JSON.stringify(state));
  throw error;
} finally {
  await browser.close();
}
