// The built browser through the category chart of the first recorded observation (#8), on the invented
// tests/fixtures/categories file, at laptop size and at 200 % zoom:
// - bars and table name each value as text, a long value whole, missing apart from Unknown, and a column fixed in the
//   parent;
// - inspecting a value lists its incidents and opens one, without changing the selection;
// - chosen values (or) are previewed, cancelled, previewed again and applied;
// - the kept incident keeps every later record;
// - bars and table rows resolve the same incidents;
// - a late reply for an earlier selection does not replace the chart;
// - Undo restores the exact earlier identity.
// Every expectation comes from tests/fixtures/categories/expected.json.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const team = expected.team;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const count = (n, unit) => `${n} ${n === 1 ? unit : unit + 's'}`;

async function session(viewport, deviceScaleFactor) {
  const page = await browser.newPage({viewport, deviceScaleFactor});
  page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
  const errors = [], selections = [], previews = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => {
    if (new URL(response.url()).pathname !== '/api/investigations/select-cases' || !response.ok()) return;
    const answer = await response.json().catch(() => null);
    if (answer) (answer.request_id.startsWith('preview-') ? previews : selections).push(answer);
  });
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  const areas = page.getByRole('navigation', {name: 'Areas'});
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await page.getByRole('button', {name: 'Filters and views'}).click();
  await page.getByRole('group', {name: 'Side panel'}).getByRole('button', {name: 'Context', exact: true}).click();
  const panel = page.getByRole('region', {name: 'At the first recorded observation'});
  await panel.getByRole('list', {name: `Opening values of ${team.name}, most frequent first`}).waitFor();
  return {page, errors, selections, previews, panel};
}

try {
  // Laptop size and 200 % zoom: every value is named as text, the long one whole, without widening the page.
  for (const [name, viewport, scale] of [['laptop', {width: 1366, height: 768}, 1], ['zoom_200', {width: 683, height: 384}, 2]]) {
    const {page, panel, errors} = await session(viewport, scale);
    const labels = await panel.getByRole('list', {name: `Opening values of ${team.name}, most frequent first`}).locator('.opening-label').allTextContents();
    check(`${name}_values_named_as_text`, [...Object.keys(team.values), 'not recorded'].every(value => labels.includes(value)), labels);
    const longBox = await panel.locator('.opening-label', {hasText: expected.long_value}).first().evaluate(element => ({overflow: element.scrollWidth > element.clientWidth + 1, text: element.textContent}));
    check(`${name}_long_value_whole`, longBox.text === expected.long_value && !longBox.overflow, longBox);
    const widened = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${name}_page_not_widened`, widened <= 1, widened);
    assert.deepEqual(errors, []);
    if (name === 'zoom_200') { await page.close(); break; }
    await page.close();
  }

  const {page, panel, errors, selections, previews} = await session({width: 1366, height: 768}, 1);
  const settled = async steps => {
    await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
    await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
  };
  await settled(0);
  const parent = selections.at(-1);
  const text = (await panel.textContent()) ?? '';
  check('fixed_column_labelled', text.includes(`Fixed in the parent: every case with a readable first record has ${expected.tenant.fixed} here`), null);
  check('denominator_and_unavailable_support_shown', text.includes(`These cases: ${count(expected.evaluable, 'incident')} with a readable first record`)
    && text.includes(`${count(expected.unevaluable.length, 'incident')} of the parent has no readable first record`), null);

  // Inspect: the incidents of a value, one opened with its whole history, the selection unchanged.
  const asked = selections.length;
  await panel.getByRole('button', {name: 'Inspect Service Desk', exact: true}).first().click();
  const found = panel.getByRole('list', {name: `Cases first recorded with ${team.name} Service Desk`});
  await found.waitFor();
  check('inspect_lists_the_value_s_incidents', same(await found.getByRole('button').allTextContents(), team.values['Service Desk']), null);
  await found.getByRole('button', {name: team.values['Service Desk'][0], exact: true}).click();
  await page.getByRole('list', {name: `Records of case ${team.values['Service Desk'][0]} in the declared order`}).waitFor();
  check('inspect_changes_nothing', selections.length === asked && await page.getByRole('list', {name: 'Steps of the selection'}).count() === 0, null);
  await page.getByRole('button', {name: 'Return to cases', exact: true}).click();
  await panel.getByRole('button', {name: 'Stop inspecting', exact: true}).click();

  // Preview, Cancel, Preview again, Apply: Service Desk or not recorded.
  for (const value of ['Service Desk', 'not recorded']) await panel.getByRole('list', {name: `Opening values of ${team.name}, most frequent first`}).getByRole('checkbox', {name: `Choose ${value}`, exact: true}).check();
  const previewButton = panel.getByRole('button', {name: 'Preview keeping cases first recorded with these values', exact: true});
  await previewButton.click();
  const pending = panel.getByRole('group', {name: `Values of ${team.name} not yet applied`});
  await pending.getByText(/^Preview:/).waitFor();
  check('preview_names_the_proposed_membership', ((await pending.textContent()) ?? '').includes(`would keep ${count(team.chosen.kept.length, 'incident')} of ${count(expected.parent, 'incident')}`), await pending.textContent());
  const barsPreview = previews.at(-1);
  await pending.getByRole('button', {name: 'Cancel', exact: true}).click();
  check('cancel_takes_nothing', selections.length === asked, null);

  // A late reply for the selection being left must not replace the chart: the next opening context is held back.
  let hold = true;
  await page.route('**/api/investigations/opening-context', async route => {
    if (hold) { hold = false; await new Promise(resolve => setTimeout(resolve, 2500)); }
    await route.continue().catch(() => undefined);
  });
  await previewButton.click();
  await pending.getByRole('button', {name: 'Apply', exact: true}).click();
  await settled(1);
  const applied = selections.at(-1);
  check('applied_membership_matches_the_oracle', same(applied.kept.case_ids, team.chosen.kept) && same(applied.unevaluable.case_ids, team.chosen.unevaluable), applied.kept);
  check('preview_and_apply_resolve_the_same_incidents', same(barsPreview.kept.case_ids, applied.kept.case_ids) && same(barsPreview.identity, applied.identity), null);
  // Undo at once: the held reply for the applied selection arrives after the parent's and must not replace it.
  await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
  await settled(0);
  check('undo_restores_the_exact_identity', same(selections.at(-1).identity, parent.identity), null);
  await page.waitForTimeout(3500);
  const legend = (await panel.getByRole('list', {name: 'Bars'}).textContent()) ?? '';
  check('late_reply_does_not_replace_the_chart', legend.includes(`These cases: ${count(expected.evaluable, 'incident')} with a readable first record`)
    && ((await panel.textContent()) ?? '').includes('These cases are the whole parent population'), legend);
  await page.unroute('**/api/investigations/opening-context');

  // Table rows resolve the same incidents as the bars, and the kept incident keeps every later record.
  await panel.getByRole('group', {name: `View of ${team.name}`}).getByRole('button', {name: 'Table', exact: true}).click();
  const table = panel.getByRole('table', {name: `Opening values of ${team.name}, as a table`});
  for (const value of ['Service Desk', 'not recorded']) {
    const box = table.getByRole('checkbox', {name: `Choose ${value}`, exact: true});
    await box.focus();
    await page.keyboard.press('Space');
  }
  await previewButton.click();
  await pending.getByText(/^Preview:/).waitFor();
  check('table_rows_resolve_the_same_incidents', same(previews.at(-1).kept.case_ids, barsPreview.kept.case_ids) && same(previews.at(-1).identity, barsPreview.identity), previews.at(-1).kept);
  await pending.getByRole('button', {name: 'Apply', exact: true}).focus();
  await page.keyboard.press('Enter');
  await settled(1);
  await page.getByRole('group', {name: 'View', exact: true}).getByRole('button', {name: 'Cases', exact: true}).click();
  await page.locator('table tbody tr button.row-open', {hasText: new RegExp(`^${team.changes_of.case}$`)}).first().click();
  const records = page.getByRole('list', {name: `Records of case ${team.changes_of.case} in the declared order`});
  await records.waitFor();
  const items = await records.getByRole('listitem').allTextContents();
  const shown = items.map(item => item.includes('Service Desk') ? 'Service Desk' : item.includes('missing') ? null : '?');
  check('kept_incident_keeps_every_later_record', same(shown, team.changes_of.context), shown);
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
