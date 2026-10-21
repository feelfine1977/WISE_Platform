// The built browser over the pilot readings of a preparation catalogue (#99), before and after a real restart of the
// service: each pilot reading opens from the Data area with all its incidents kept, and one incident's complete
// history shows every record its evidence holds. The output holds checks by the pilots' places only.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const {pilots} = JSON.parse(await readFile(configPath, 'utf8'));
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await (await browser.newContext({viewport: {width: 1366, height: 768}})).newPage();
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const areas = page.getByRole('navigation', {name: 'Areas'});
const view = name => page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name, exact: true});

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0 || !!document.querySelector('nav[aria-label="Areas"]'));
  for (const [index, pilot] of pilots.entries()) {
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${pilot.preparation_id}$`)}).click();
    await page.waitForFunction(n => (document.querySelector('.population')?.textContent ?? '').includes(`${n} of ${n} incidents`), pilot.incidents);
    await view('Incidents').click();
    const row = page.getByRole('table', {name: 'Kept incidents'}).getByRole('button', {name: pilot.case_id, exact: true});
    const [evidence] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/investigations/case-evidence'), row.click()]);
    await page.getByRole('heading', {name: `Incident ${pilot.case_id}`}).waitFor();
    const shown = await page.locator('ol.history > li').count();
    check(`pilot_${index + 1}_complete_history_shown`, shown === pilot.records && (await evidence.json()).records.length === pilot.records, {shown, expected: pilot.records});
    await page.keyboard.press('Escape');
  }
  const origin = new URL(base).origin;
  check('every_request_stays_on_the_local_host', requests.every(url => url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')), null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
