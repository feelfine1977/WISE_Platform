// The built browser at first use: the application's own workspace, the packaged synthetic example read into it and
// its incidents shown, an incident opened by keyboard and another by pointer, and the Data area naming the workspace.
// Run twice by qualify_first_use.py, around an actual service restart. Only checks, counts and identities are written.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, expectedPath, phase = 'first'] = process.argv.slice(2);
const expected = JSON.parse(await readFile(expectedPath, 'utf8'));
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], evidenceBodies = [], posts = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const path = new URL(request.url()).pathname;
  if (request.method() === 'POST' || request.method() === 'PUT') posts.push(path);
  if (path === '/api/investigations/case-evidence') evidenceBodies.push(JSON.parse(request.postData()));
});
let population = null;
page.on('response', async response => {
  if (new URL(response.url()).pathname === '/api/investigations/open-population' && response.ok()) population = await response.json();
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const areas = page.getByRole('navigation', {name: 'Areas'});
try {
  await page.goto(base);
  const main = page.locator('main').first();
  await page.getByRole('heading', {name: /^Incident|incidents/i}).first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0
    && !document.body.textContent.includes('Selecting the incidents and drawing their map'));
  if (process.env.WISE_BROWSER_DUMP_TEXT) await writeFile(process.env.WISE_BROWSER_DUMP_TEXT, (await main.textContent()) ?? '');
  const shown = (await main.textContent()) ?? '';
  for (const text of expected.texts) check(`shows: ${text}`, shown.includes(text), text);
  check('population_counts', population && population.population.case_count === expected.cases && population.population.record_count === expected.records,
    population && population.population);
  // By keyboard: the first incident's button, then Enter; by pointer: another incident.
  const row = id => page.locator('table tbody tr button.row-open', {hasText: new RegExp(`^${id}$`)}).first();
  // The investigation opens on its map; the analyst switches to the incident list, enters it at its first incident,
  // moves with the arrow keys to the chosen one and opens it with Enter.
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Incidents', exact: true}).click();
  await page.locator('table tbody tr button.row-open').first().waitFor({state: 'visible'});
  await page.locator('table tbody tr button.row-open').first().focus();
  const place = expected.order.indexOf(expected.keyboard_case);
  for (let step = 0; step < place; step++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', {name: 'Incident ' + expected.keyboard_case, exact: true}).waitFor();
  const keyboardList = page.getByRole('list', {name: `Records of incident ${expected.keyboard_case} in the declared order`});
  await keyboardList.waitFor();
  const keyboardRecords = await keyboardList.getByRole('listitem').count();
  check('keyboard_opens_every_record', keyboardRecords === expected.case_records[expected.keyboard_case], keyboardRecords);
  await page.getByRole('button', {name: 'Return to incidents', exact: true}).click();
  await row(expected.pointer_case).click();
  await page.getByRole('heading', {name: 'Incident ' + expected.pointer_case, exact: true}).waitFor();
  const pointerList = page.getByRole('list', {name: `Records of incident ${expected.pointer_case} in the declared order`});
  await pointerList.waitFor();
  const pointerRecords = await pointerList.getByRole('listitem').count();
  check('pointer_opens_every_record', pointerRecords === expected.case_records[expected.pointer_case], pointerRecords);
  // Both paths send the same operation, for the same population, differing only in the incident.
  const strip = body => { const {request_id, query_revision, case_id, ...rest} = body; return rest; };
  check('keyboard_and_pointer_send_the_same_operation', evidenceBodies.length >= 2 && JSON.stringify(strip(evidenceBodies.at(-2))) === JSON.stringify(strip(evidenceBodies.at(-1)))
    && evidenceBodies.at(-2).case_id === expected.keyboard_case && evidenceBodies.at(-1).case_id === expected.pointer_case, evidenceBodies.length);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByText('Writable: sources and readings are stored here', {exact: false}).waitFor();
  check('data_area_names_a_writable_workspace', await page.getByText(expected.workspace_path, {exact: true}).first().isVisible(), null);
  check('example_read_once', phase === 'first' ? posts.filter(path => path === '/api/sources').length === 1 : !posts.includes('/api/sources'), posts);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks, identity: population.identity, population: population.population}));
} finally {
  await browser.close();
}
