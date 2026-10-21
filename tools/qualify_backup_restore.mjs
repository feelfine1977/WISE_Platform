// The built browser through a workspace backup and restore (#26) around an actual restart of the service. First, in
// the Data area, the workspace holding a saved question is backed up into a new folder. Again, in a new service process
// on another workspace, the backup is restored into a new folder, the restored workspace is opened, its saved
// investigation is listed and reopened, and an incident's complete history is read.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath, phase] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 900}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], workspaces = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  if (new URL(response.url()).pathname !== '/api/workspaces/open' || !response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (answer) workspaces.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const areas = page.getByRole('navigation', {name: 'Areas'});
const panel = () => page.locator('details.workspace-backup');

try {
  await page.goto(base);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await panel().getByText('Back up or restore').click();
  if (phase === 'first') {
    await panel().getByLabel(/^Backup folder/).fill(config.backup);
    await panel().getByRole('button', {name: 'Back up this workspace', exact: true}).click();
    const said = await panel().getByText(/^Backed up into /).textContent();
    check('backup_reported_with_its_inventory', said.includes('1 source, 1 reading, 1 saved investigation, 1 revision, 0 score runs'), said);
    check('backup_says_what_it_holds', ((await panel().textContent()) ?? '').includes('Stages kept in this browser are not part of it.'), null);
  } else {
    await panel().getByLabel(/^Backup to restore/).fill(config.backup);
    await panel().getByLabel(/^Restore into/).fill(config.restored);
    await panel().getByRole('button', {name: 'Restore the backup', exact: true}).click();
    const said = await panel().getByText(/^Restored and checked into /).textContent();
    check('restore_checked_and_same_workspace', said.includes(`It is the same workspace, ${config.workspace_id}`), said);
    await panel().getByRole('button', {name: 'Open the restored workspace', exact: true}).click();
    while (workspaces.length === 0 || workspaces.at(-1).workspace_id !== config.workspace_id) await page.waitForTimeout(100);
    check('restored_workspace_opened_with_its_identity', workspaces.at(-1).workspace_id === config.workspace_id && workspaces.at(-1).sources.length === 1, null);
    await areas.getByRole('button', {name: 'Saved', exact: true}).click();
    const reopen = page.getByRole('button', {name: `Reopen ${config.name}`, exact: true});
    await reopen.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent && document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === 2);
    const line = (await page.getByRole('region', {name: 'Saved investigation'}).textContent()) ?? '';
    check('saved_finding_reopened', line.includes(config.name) && line.includes('QuestionIs it still there after a restore?'), line);
    await page.getByRole('group', {name: 'View'}).getByRole('button', {name: 'Cases', exact: true}).click();
    await page.locator('table tbody tr button.row-open', {hasText: /^F01$/}).click();
    const list = page.getByRole('list', {name: 'Records of case F01 in the declared order'});
    await list.waitFor();
    const records = await list.getByRole('listitem').allTextContents();
    check('complete_evidence_read_after_restore', records.length === 2 && records[0].includes('Opened') && records[1].includes('Resolved'), records);
  }
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
