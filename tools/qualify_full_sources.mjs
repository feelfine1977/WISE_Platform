// The built browser over a reopened investigation: its population, profile and evidence views.
// Each view's start and end are reported in wall-clock seconds, so the caller can attribute the browser's
// sampled memory to it. Nothing about the records is written out.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, workspace, savedName, revision, caseId, output, playwright, chrome] = process.argv.slice(2);
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
page.setDefaultTimeout(300000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const areas = page.getByRole('navigation', {name: 'Areas'});
const views = {};

async function view(name, action) {
  const start = Date.now() / 1000;
  await action();
  views[name] = {start, end: Date.now() / 1000};
}

async function answered(route, action) {
  const pending = page.waitForResponse(response => response.url().endsWith(route) && response.request().method() === 'POST');
  await action();
  const response = await pending;
  assert.equal(response.status(), 200, route);
  return response.json();
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
    const reopened = await answered('/api/investigations/reopen', () =>
      page.getByRole('button', {name: 'Reopen ' + savedName, exact: true}).click());
    assert.equal(reopened.revision.saved_revision_id, revision);
    await areas.getByRole('button', {name: 'Investigations', exact: true}).click();
    await incident().waitFor();
  });
  await view('profile', async () => {
    await areas.getByRole('button', {name: 'Purchasing analysis', exact: true}).click();
    await page.getByRole('region', {name: 'Understand the purchasing flows', exact: true}).waitFor();
    await page.waitForLoadState('networkidle');
  });
  await view('evidence', async () => {
    await areas.getByRole('button', {name: 'Investigations', exact: true}).click();
    await answered('/api/investigations/case-evidence', () => incident().click());
    await page.getByRole('heading', {name: 'Incident ' + caseId, exact: true}).waitFor();
  });
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify(views));
} finally {
  await browser.close();
}
