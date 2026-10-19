// The built browser over the application's own workspace (#47): created at first launch without a folder question,
// reused at the next launch, replaced by a launch override and by a folder chosen in the Data area, and refused with
// Try again or another folder as the way out. One phase per run of qualify_default_workspace.py, each in a fresh
// browser over its own service process. Only checks, counts and identities are written; never a path.
import assert from 'node:assert/strict';
import {chmod, readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath, phase] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], posts = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (request.method() === 'POST' || request.method() === 'PUT') posts.push(new URL(request.url()).pathname);
});
let population = null;
page.on('response', async response => {
  if (new URL(response.url()).pathname === '/api/investigations/open-population' && response.ok()) population = await response.json();
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const areas = page.getByRole('navigation', {name: 'Areas'});
const workspaceLine = () => page.getByRole('region', {name: 'Workspace'});

async function incidentsShown() {
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0
    && !document.body.textContent.includes('Selecting the incidents and drawing their map'));
  const shown = (await page.locator('main').first().textContent()) ?? '';
  check('example_incidents_shown', shown.includes(`${config.cases} of ${config.cases} incidents`) && shown.includes(`${config.records} of ${config.records} records`), null);
  check('population_counts', population && population.population.case_count === config.cases && population.population.record_count === config.records,
    population && population.population);
}

async function names(path, own) {
  const line = workspaceLine();
  await line.getByText(path, {exact: true}).waitFor();
  const text = (await line.textContent()) ?? '';
  return text.includes(own ? "The application's own folder" : 'A folder you chose.') && text.includes('Writable: sources and readings are stored here');
}

async function useFolder(path) {
  const details = workspaceLine().locator('details');
  if (await details.count() && !(await details.first().evaluate(element => element.open))) await details.first().locator('summary').click();
  await page.getByLabel('Folder path').first().fill(path);
  await page.getByRole('button', {name: 'Open workspace', exact: true}).first().click();
}

try {
  await page.goto(base);
  if (phase === 'create' || phase === 'reuse' || phase === 'launch-override') {
    // No folder is asked for: the incidents of the example appear without any input.
    await incidentsShown();
    check('no_folder_question_before_the_incidents', !posts.includes('/api/workspaces/open'), posts);
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    check('data_area_names_the_workspace', await names(phase === 'launch-override' ? config.override : config.default, true), null);
    check(phase === 'reuse' ? 'reused_without_reading_the_example_again' : 'example_read_once',
      phase === 'reuse' ? !posts.includes('/api/sources') : posts.filter(path => path === '/api/sources').length === 1, posts);
  } else if (phase === 'data-override') {
    await incidentsShown();
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    check('data_area_names_the_own_workspace', await names(config.default, true), null);
    // A folder that already holds other files is refused by name; another folder can be chosen at once.
    await useFolder(config.foreign);
    const refused = page.getByRole('alert').filter({hasText: 'This folder cannot be used as a workspace'});
    await refused.waitFor();
    check('foreign_folder_refused_in_words', ((await refused.textContent()) ?? '').length > 'This folder cannot be used as a workspace'.length, null);
    await useFolder(config.chosen);
    check('chosen_folder_replaces_the_own', await names(config.chosen, false), null);
    await workspaceLine().locator('summary').click();
    await page.getByRole('button', {name: "Use the application's own folder", exact: true}).click();
    check('way_back_to_the_own_folder', await names(config.default, true), null);
  } else if (phase === 'unwritable') {
    const alert = page.getByRole('alert').filter({hasText: 'The application could not open its workspace'});
    await alert.waitFor();
    check('unwritable_refused_in_words', ((await alert.textContent()) ?? '').includes('Try again'), await alert.textContent());
    check('nothing_read_before_a_workspace', !posts.includes('/api/sources'), posts);
    // The analyst makes the folder writable again and tries again: the application starts as at first use.
    await chmod(config.unlock, 0o700);
    await alert.getByRole('button', {name: 'Try again', exact: true}).click();
    await incidentsShown();
    await areas.getByRole('button', {name: 'Data', exact: true}).click();
    check('try_again_opens_the_own_workspace', await names(config.default, true), null);
  } else if (phase === 'corrupt') {
    const alert = page.getByRole('alert').filter({hasText: 'The application could not open its workspace'});
    await alert.waitFor();
    check('nothing_read_before_a_workspace', !posts.includes('/api/sources'), posts);
    await page.getByRole('button', {name: 'Go to the Data area', exact: true}).click();
    await page.getByRole('alert').filter({hasText: "The application's own folder cannot be used as a workspace"}).waitFor();
    check('data_area_states_the_refusal', true, null);
    await useFolder(config.chosen);
    check('another_folder_recovers', await names(config.chosen, false), null);
  } else {
    throw new Error(`unknown phase ${phase}`);
  }
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks, identity: population?.identity ?? null}));
} finally {
  await browser.close();
}
