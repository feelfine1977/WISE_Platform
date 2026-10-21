// The built browser on what the Data area says about capacity (#29): the measured tier and the memory the service may
// use stand beside the import, and a file whose reading would not fit that memory is refused before it is read, with
// the memory it needs and what to do, while the page stays usable.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 768}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };

try {
  await page.goto(base);
  await page.getByRole('navigation', {name: 'Areas'}).getByRole('button', {name: 'Data', exact: true}).click();
  const note = page.locator('.capacity-note');
  await note.filter({hasText: 'MiB, is refused before it starts'}).waitFor();
  const said = (await note.textContent()) ?? '';
  check('tier_and_budget_stated_beside_the_import', said.startsWith('Measured: the incident journey with up to 50,000 incidents and 394,433 records')
    && said.includes(`may use, ${config.budget_mib} MiB, is refused before it starts`) && said.includes('Larger files are not measured') && said.includes('nothing is sampled'), said);
  await page.getByLabel('Add an event-history CSV').setInputFiles(config.file);
  const refusal = page.getByRole('alert').filter({hasText: 'more memory than the service may use now'});
  await refusal.waitFor();
  const text = (await refusal.textContent()) ?? '';
  check('beyond_budget_refused_before_reading_with_what_to_do', text.includes('Nothing was read or changed') && text.includes('WISE_MEMORY_BUDGET_BYTES')
    && text.includes('Close other work you have open'), text);
  check('page_still_usable_after_the_refusal', await page.getByLabel('Add an event-history CSV').isEnabled(), null);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
