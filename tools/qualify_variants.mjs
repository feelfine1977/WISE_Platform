// The built browser through the actual variants (#13) of the invented tests/fixtures/variants file: the Variants view is
// found in the side panel; every sequence, with its repeats and the empty one, and the inventory reconcile with the
// population. A variant's incidents are listed without a step; a listed history opens with its unlabelled record and the
// focus returns. Each variant is previewed and kept by keyboard with its exact members, the incident of unknown order
// not evaluable; Cancel takes nothing and Undo restores the exact parent. Expectations: tests/fixtures/variants/expected.json.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const page = await browser.newPage({viewport: {width: 1366, height: 768}});
page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
const errors = [], selections = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  if (new URL(response.url()).pathname !== '/api/investigations/select-cases' || !response.ok()) return;
  const answer = await response.json().catch(() => null);
  if (answer && !answer.request_id.startsWith('preview-')) selections.push(answer);
});
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const areas = page.getByRole('navigation', {name: 'Areas'});
async function settled(steps) {
  await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
  await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
}
const panel = () => page.locator('section.view-panel[aria-labelledby="variants-title"]');
const items = () => panel().getByRole('list', {name: 'Variants, most incidents first'}).locator(':scope > li');
const tableIds = () => page.locator('table tbody tr button.row-open').allTextContents();

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
  await areas.getByRole('button', {name: 'Data', exact: true}).click();
  await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, expected.incidents);
  await settled(0);
  const parent = selections.at(-1);
  const asked = selections.length;

  // A named Variants entry in the side panel; its sequences are actual and complete, apart from the map's routes.
  await page.getByRole('button', {name: 'Filters and views'}).click();
  await page.getByRole('group', {name: 'Side panel'}).getByRole('button', {name: 'Patterns', exact: true}).click();
  await panel().getByRole('heading', {name: 'Variants'}).waitFor();
  await items().first().waitFor();
  const shown = await items().evaluateAll(list => list.map(item => [...item.querySelectorAll('.variant-step')].map(step => step.textContent)));
  check('variants_are_the_oracle_s_complete_sequences', same(shown, expected.variants.map(variant => variant.activities)), shown);
  const figures = await items().locator('.variant-figures .visually-hidden').allTextContents();
  check('counts_and_shares_name_their_units', same(figures.map(text => text.split(' of ')[0]), expected.variants.map(variant => String(variant.members.length)))
    && figures.every(text => text.includes(`of ${expected.known_order} incidents whose order is known`)), figures);
  const text = (await panel().textContent()) ?? '';
  const inVariants = expected.variants.reduce((total, variant) => total + variant.members.length, 0);
  check('inventory_reconciles_with_the_population', text.includes(`${count(inVariants, 'incident')} in ${count(expected.variants.length, 'variant')} and ${count(expected.unevaluable.length, 'incident')} with no known order: ${count(expected.incidents, 'incident')} counted exactly, none sampled.`), text);
  check('repeats_and_the_empty_sequence_shown', text.includes('No labelled activity: every record of these incidents lacks an activity label.')
    && same(shown[expected.repeated.variant], expected.repeated.labels_in_order), null);
  check('variants_told_apart_from_routes_and_partial_patterns', text.includes('Each variant is one actual sequence of labelled activities in the declared order, repeats included.')
    && text.includes('Only a whole sequence can be kept here. Partial patterns, wildcards, gaps and “not followed by” are not available.'), null);

  // Listing a variant's incidents is a view: no selection is asked for and no step is taken.
  const ordinary = expected.variants[0];
  const list = panel().getByRole('button', {name: `List the ${count(ordinary.members.length, 'incident')} of variant 1 in the table`});
  await list.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, ordinary.members.length);
  check('listing_takes_no_step', same((await tableIds()).sort(), ordinary.members) && selections.length === asked && await page.getByRole('list', {name: 'Steps of the selection'}).count() === 0, await tableIds());
  // A listed history opens whole, with the record left out of the sequence for lacking a label.
  const witness = expected.missing_label_witness;
  await page.locator('table tbody tr button.row-open', {hasText: new RegExp(`^${witness.case}$`)}).click();
  const records = page.getByRole('list', {name: `Records of incident ${witness.case} in the declared order`});
  await records.waitFor();
  const recordTexts = await records.getByRole('listitem').allTextContents();
  check('history_keeps_the_unlabelled_record', recordTexts.length === witness.source_positions.length
    && witness.source_positions.every(position => recordTexts.some(item => item.includes(`source position ${position}`))), recordTexts);
  await page.getByRole('button', {name: 'Return to incidents', exact: true}).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(id => document.activeElement?.textContent === id, witness.case);
  check('return_restores_the_focus', true);
  await page.getByRole('button', {name: 'Show all kept incidents'}).click().catch(() => undefined);

  // Each variant: previewed, cancelled once, applied by keyboard with its exact members, and undone to the exact parent.
  const everyone = [...new Set(expected.variants.flatMap(variant => variant.members))].sort();
  for (const [index, variant] of expected.variants.entries()) {
    const rank = index + 1;
    const preview = panel().getByRole('button', {name: `Preview keeping the ${count(variant.members.length, 'incident')} of variant ${rank}`});
    await preview.focus();
    await page.keyboard.press('Enter');
    const pending = panel().getByRole('group', {name: `Variant ${rank} not yet applied`});
    const line = await pending.getByText(/^Preview:/).textContent();
    const exact = `Preview: would keep ${count(variant.members.length, 'incident')} of ${count(expected.incidents, 'incident')}; ${everyone.length - variant.members.length} removed, ${expected.unevaluable.length} not evaluable.`;
    check(`variant_${rank}_preview_exact`, line.startsWith(exact), [line, exact]);
    if (index === 0) {
      await pending.getByRole('button', {name: 'Cancel', exact: true}).click();
      await page.waitForFunction(() => document.activeElement?.hasAttribute('data-variant-preview'));
      check('cancel_takes_nothing_and_returns_the_focus', selections.length === asked && await pending.count() === 0, selections.length);
      await preview.focus();
      await page.keyboard.press('Enter');
    }
    await pending.getByRole('button', {name: 'Apply', exact: true}).focus();
    await page.keyboard.press('Enter');
    await settled(1);
    const applied = selections.at(-1);
    check(`variant_${rank}_keeps_its_exact_members`, same(applied.kept.case_ids, variant.members) && same(applied.unevaluable.case_ids, expected.unevaluable)
      && same(applied.removed.case_ids, everyone.filter(id => !variant.members.includes(id))) && applied.predicate_results[0].predicate.variant.id === variant.id, applied.kept);
    if (index === expected.repeated.variant) {
      const steps = (await page.getByRole('list', {name: 'Steps of the selection'}).textContent()) ?? '';
      check('chip_names_the_exact_sequence_with_repeats', steps.includes(`complete sequence is exactly ${variant.activities.map(label => `“${label}”`).join(' → ')}`), steps);
      check('unknown_order_named_for_this_step_only', steps.includes('for other views and steps they stay evaluable'), steps);
    }
    await page.getByRole('group', {name: 'Steps'}).getByRole('button', {name: 'Undo', exact: true}).click();
    await settled(0);
    check(`variant_${rank}_undo_restores_the_exact_parent`, same(selections.at(-1).identity, parent.identity), null);
  }
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
