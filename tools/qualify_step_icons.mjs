// The built browser through the actions of the bar of steps (#92) over the invented tests/fixtures/span-gap file: at
// 1280 x 720 and 900 x 700, Undo, Redo and Clear all are icon buttons with names and tooltips, disabled in their slots with
// the reason in their description while unusable, and their places stay the same with no step, after a step, after Undo,
// while a selection is being answered and after Clear all.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const [base, output, playwright, chrome, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expected = config.expected;
const incidents = expected.orders['observed_span_hours descending'].length;
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless: true, executablePath: chrome});
process.once('SIGTERM', async () => { await browser.close(); process.exit(1); });
const checks = {};
const check = (name, passed, detail) => { checks[name] = Boolean(passed); assert.ok(passed, `${name}: ${JSON.stringify(detail ?? null)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NAMES = ['Undo', 'Redo', 'Clear all'];

async function journey(width, height) {
  const page = await browser.newPage({viewport: {width, height}});
  page.setDefaultTimeout(Number(process.env.WISE_BROWSER_TIMEOUT_MS ?? 60000));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const size = `${width}x${height}`;
  const group = () => page.getByRole('group', {name: 'Steps', exact: true});
  async function settled(steps) {
    await page.waitForFunction(() => !document.querySelector('.selection-status')?.textContent);
    await page.waitForFunction(n => document.querySelectorAll('ul[aria-label="Steps of the selection"] > li').length === n || (n === 0 && !document.querySelector('ul[aria-label="Steps of the selection"]')), steps);
  }
  /** Each slot: its name, whether it is disabled, its tooltip, its description, and its place and size on the page. */
  const slots = () => group().getByRole('button').evaluateAll(buttons => buttons.map(button => {
    const box = button.getBoundingClientRect();
    const description = (button.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map(id => document.getElementById(id)?.textContent).join(' | ');
    return {name: button.getAttribute('aria-label'), disabled: button.disabled, title: button.getAttribute('title'), description, icon: !!button.querySelector('svg.icon'),
      // The words drawn on the button: the description is there for assistive technology only, hidden from sight.
      words: (() => { const copy = button.cloneNode(true); copy.querySelectorAll('.visually-hidden').forEach(node => node.remove()); return copy.textContent.trim(); })(), box: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]};
  }));
  const places = list => list.map(slot => slot.box);
  // Where the bar of steps and what stands beside and above it are, said when a slot moves.
  const rows = () => page.evaluate(() => {
    const bar = document.querySelector('.selection-bar');
    const place = element => [element.className || element.tagName, Math.round(element.getBoundingClientRect().y * 10) / 10, Math.round(element.getBoundingClientRect().height * 10) / 10];
    const above = [];
    for (let element = bar; element && element !== document.body; element = element.parentElement) {
      for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) above.push(place(sibling));
    }
    return {bar: bar ? place(bar) : null, above};
  });
  try {
    await page.goto(base);
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr button.row-open').length > 0);
    await page.getByRole('navigation', {name: 'Areas'}).getByRole('button', {name: 'Data', exact: true}).click();
    await page.getByRole('table', {name: 'Prepared readings in this workspace'}).getByRole('button', {name: new RegExp(`preparation ${config.preparation_id}$`)}).click();
    await page.waitForFunction(n => document.querySelectorAll('table tbody tr button.row-open').length === n, incidents);
    await settled(0);

    const none = await slots();
    const noneRows = await rows();
    check(`${size}_three_icon_buttons_named_with_tooltips`, same(none.map(slot => slot.name), NAMES) && none.every(slot => slot.icon && slot.words === '' && slot.title.startsWith(slot.name + '\n')), none);
    check(`${size}_unusable_disabled_with_reason`, none.every(slot => slot.disabled) && same(none.map(slot => slot.description), [
      'Nothing to undo: the steps have not been changed.', 'Nothing to redo: no change of the steps has been undone.', 'No step to clear: every incident of the parent is kept.']), none);
    if (process.env.WISE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.WISE_SCREENSHOT_DIR}/issue92-step-icons-${size}.png`, clip: {x: 0, y: 0, width, height: 200}});

    // A step from the Filters.
    await page.getByRole('button', {name: 'Filters and views'}).click();
    await page.getByRole('group', {name: 'Side panel'}).getByRole('button', {name: 'Filters', exact: true}).click();
    const range = page.locator('section.incident-filters details', {has: page.getByText('A range of records, span or longest gap', {exact: true})});
    await range.locator('summary').click();
    await range.getByLabel('From, included (records)').fill('2');
    await range.getByRole('button', {name: 'Keep this range', exact: true}).click();
    // The answer is held back a while, so that the bar is seen while the selection is answered.
    let hold = true;
    await page.route('**/api/investigations/select-cases', async route => {
      if (hold && !route.request().postData()?.includes('"preview-')) await new Promise(resolve => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.getByRole('group', {name: 'Filter not yet taken'}).getByRole('button', {name: 'Take this step', exact: true}).click();
    await page.waitForFunction(() => !!document.querySelector('.selection-status')?.textContent);
    const answering = await slots();
    const answeringRows = await rows();
    hold = false;
    await settled(1);
    const stepped = await slots();
    check(`${size}_after_a_step`, same(stepped.map(slot => slot.disabled), [false, true, false]) && stepped[0].description === 'Takes back the last change of the steps.', stepped);
    await group().getByRole('button', {name: 'Undo', exact: true}).click();
    await settled(0);
    const undone = await slots();
    check(`${size}_after_undo`, same(undone.map(slot => slot.disabled), [true, false, true]), undone);
    await group().getByRole('button', {name: 'Redo', exact: true}).click();
    await settled(1);
    await group().getByRole('button', {name: 'Clear all', exact: true}).click();
    await settled(0);
    const cleared = await slots();
    check(`${size}_after_clear_all`, same(cleared.map(slot => slot.disabled), [false, true, true]), cleared);
    if (process.env.WISE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.WISE_SCREENSHOT_DIR}/issue92-step-icons-${size}-cleared.png`, clip: {x: 0, y: 0, width, height: 200}});
    // The bar never reflows: every slot keeps its place and size in every state, the answering one included.
    check(`${size}_slots_never_move`, [answering, stepped, undone, cleared].every(state => same(places(state), places(none))), {none: places(none), answering: places(answering), stepped: places(stepped), undone: places(undone), cleared: places(cleared), noneRows, answeringRows});
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

try {
  await journey(1280, 720);
  await journey(900, 700);
  await writeFile(output, JSON.stringify({checks}));
} finally {
  await browser.close();
}
