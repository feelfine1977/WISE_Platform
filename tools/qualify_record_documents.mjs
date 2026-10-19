// The built browser over the invented documents of #132: the folder setting in the Data view, an incident's documents
// read by keyboard beside its timeline, the stated attachment types, the largest allowed document within a second, and,
// after an actual service restart, the same document in a fresh browser. Only checks and timings are written out.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, workspace, savedName, output, playwright, chrome, phase = 'review'] = process.argv.slice(2);
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const areas = page.getByRole('navigation', {name: 'Areas'});
const checks = {};
const check = (name, passed) => { checks[name] = Boolean(passed); assert.ok(passed, name); };

async function answered(path, action) {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST'), action()]);
  return response.status();
}

async function openIncident(caseId) {
  await areas.getByRole('button', {name: 'Investigations', exact: true}).click();
  const button = page.getByRole('button', {name: caseId, exact: true}).first();
  await answered('/api/investigations/case-evidence', () => button.click());
  await page.getByRole('heading', {name: 'Incident ' + caseId, exact: true}).waitFor();
  return page.getByRole('list', {name: `Records of incident ${caseId} in the declared order`});
}

const pane = page.locator('section.document-pane');
const recordEntry = (list, activity) => list.getByRole('listitem').filter({hasText: activity}).first();
let largestMs = null;
try {
  await page.goto(base);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByText('Use another folder', {exact: true}).click();
  await page.getByLabel('Folder path').fill(workspace);
  await answered('/api/workspaces/open', () => page.getByRole('button', {name: 'Open workspace', exact: true}).click());
  await page.getByText('The folder is available on this computer.', {exact: false}).waitFor();
  check('data_view_shows_the_document_folder', true);
  await areas.getByRole('button', {name: 'Saved', exact: true}).click();
  await answered('/api/investigations/reopen', () => page.getByRole('button', {name: 'Reopen ' + savedName, exact: true}).click());
  let records = await openIncident('I-1');
  // By keyboard: the record's "Open document", the masked email, the next documents with the skipped call counted, Escape back.
  const email = recordEntry(records, 'Email received');
  await email.getByRole('button', {name: 'Open document', exact: true}).focus();
  await answered('/api/documents/read', () => page.keyboard.press('Enter'));
  await pane.getByText('Invented question about an invented invoice', {exact: true}).waitFor();
  check('email_masked_marker_shown', (await pane.getByRole('note').first().textContent()).startsWith('Masked text'));
  check('timeline_stays_visible', await page.getByRole('region', {name: 'Elapsed time of incident I-1'}).isVisible());
  if (phase === 'review') {
    await pane.getByRole('button', {name: 'Next document', exact: true}).focus();
    await answered('/api/documents/read', () => page.keyboard.press('Enter'));
    await pane.getByText('Invented internal note', {exact: true}).waitFor();
    await pane.getByRole('button', {name: 'Next document', exact: true}).focus();
    await answered('/api/documents/read', () => page.keyboard.press('Enter'));
    await pane.getByText('Invented status change', {exact: true}).waitFor();
    check('next_skips_and_counts_a_record_without_a_document', await pane.getByText('1 record without a document skipped.', {exact: false}).isVisible());
    await page.keyboard.press('Escape');
    await pane.waitFor({state: 'detached'});
    check('escape_returns_focus_to_the_record', await page.evaluate(() => document.activeElement?.tagName === 'LI'
      && document.activeElement.textContent.includes('Status changed')));
    // From the timeline: the first mark offers its document; D opens it.
    const mark = page.getByRole('group', {name: /Recorded times of incident I-1/}).getByRole('button').first();
    check('timeline_mark_offers_its_document', /a document is available, press D to open it$/.test(await mark.getAttribute('aria-label')));
    await mark.focus();
    await answered('/api/documents/read', () => page.keyboard.press('d'));
    await pane.getByText('Invented question about an invented invoice', {exact: true}).waitFor();
    // Attachments: a stated document type is handed to the default program; a mismatched one is refused; nothing opens by itself.
    check('program_script_archive_and_shortcut_not_offered', (await pane.getByText(/not opened/).count()) === 4);
    await answered('/api/documents/open-attachment', () => pane.getByRole('button', {name: 'Open Invented letter.pdf', exact: true}).click());
    await pane.getByText("Invented letter.pdf was handed to this computer's default program.", {exact: true}).waitFor();
    await answered('/api/documents/open-attachment', () => pane.getByRole('button', {name: 'Open Invented fake.pdf', exact: true}).click());
    await pane.getByText('Invented fake.pdf was not opened: its content does not match its declared type and extension.', {exact: true}).waitFor();
    check('attachments_follow_the_stated_list', true);
    await pane.getByRole('button', {name: 'Close document', exact: true}).click();
    // The largest allowed document within a second; one byte more is refused with its size; markup stays text.
    await page.getByRole('button', {name: 'Return to incidents', exact: true}).click();
    records = await openIncident('I-3');
    const started = Date.now();
    await recordEntry(records, 'Largest allowed').getByRole('button', {name: 'Open document', exact: true}).click();
    await pane.getByText('Invented largest note', {exact: true}).waitFor();
    largestMs = Date.now() - started;
    check('largest_allowed_document_within_a_second', largestMs < 1000);
    await pane.getByRole('button', {name: 'Close document', exact: true}).click();
    await recordEntry(records, 'Too large').getByRole('button', {name: 'Open document', exact: true}).click();
    await pane.getByText(/^Not available: Too large to show: 1,048,58\d bytes/).waitFor();
    check('too_large_is_refused_with_its_size', true);
    await pane.getByRole('button', {name: 'Close document', exact: true}).click();
    await recordEntry(records, 'Markup document').getByRole('button', {name: 'Open document', exact: true}).click();
    await pane.getByText('<i>Invented markup title</i>', {exact: true}).waitFor();
    check('markup_stays_text', (await pane.locator('img, script, a, b, i, u, iframe').count()) === 0);
  }
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks, largest_ms: largestMs}));
} finally {
  await browser.close();
}
