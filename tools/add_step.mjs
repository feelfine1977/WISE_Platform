// The one entry of every step by a value (#94): "+ Add step" opens a short list of the kinds of step; each opens its
// form in the panel "Add a step", and applying adds the step at once and closes the panel. Shared by the journeys.

/** Opens "+ Add step" and the form of one kind of step; gives the panel that holds the form. */
export async function addStep(page, kind) {
  const panel = page.getByRole('group', {name: 'Add a step'});
  if (!(await panel.isVisible().catch(() => false))) await page.getByRole('button', {name: '+ Add step', exact: true}).click();
  const other = panel.getByRole('button', {name: 'Other kinds of step', exact: true});
  if (await other.count()) await other.click();
  await panel.getByRole('list', {name: 'Kinds of step'}).getByRole('button', {name: kind, exact: true}).click();
  return panel;
}

/** Closes the panel without a step, where a form was only looked at or refused. */
export async function closeAddStep(page) {
  const panel = page.getByRole('group', {name: 'Add a step'});
  if (await panel.isVisible().catch(() => false)) await panel.getByRole('button', {name: 'Close', exact: true}).click();
}
