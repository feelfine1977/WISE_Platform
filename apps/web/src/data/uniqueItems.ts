/*
 * The JSON Schema keyword "uniqueItems", checked in one pass over each array.
 *
 * The schema validator compares every pair of items when the item type is behind a reference,
 * which takes seconds for the incident ids of a large population. Validation therefore uses a copy
 * of the contract without the keyword, and this module checks each array the contract marks as
 * unique, following the contract's own references, properties, items and alternatives.
 */

type SchemaNode = { [keyword: string]: unknown };

const isNode = (value: unknown): value is SchemaNode => typeof value === "object" && value !== null && !Array.isArray(value);

/** A copy of a schema without the "uniqueItems" keyword anywhere in it. */
export function withoutUniqueItems<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((item) => withoutUniqueItems(item)) as T;
  if (!isNode(schema)) return schema;
  const copy: SchemaNode = {};
  for (const [keyword, value] of Object.entries(schema)) {
    if (keyword !== "uniqueItems") copy[keyword] = withoutUniqueItems(value);
  }
  return copy as T;
}

/** A text that is equal for equal JSON values, whatever the order of object members. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isNode(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function resolve(root: SchemaNode, reference: string): SchemaNode | null {
  if (!reference.startsWith("#/")) return null;
  let node: unknown = root;
  for (const part of reference.slice(2).split("/")) {
    if (!isNode(node)) return null;
    node = node[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return isNode(node) ? node : null;
}

/** Whether every array of a value that the schema marks "uniqueItems" holds no item twice. */
export function uniqueItemsHold(root: SchemaNode, schema: unknown, value: unknown): boolean {
  if (!isNode(schema)) return true;
  if (typeof schema.$ref === "string") {
    const target = resolve(root, schema.$ref);
    if (target !== null && !uniqueItemsHold(root, target, value)) return false;
  }
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    const branches = schema[keyword];
    if (Array.isArray(branches) && !branches.every((branch) => uniqueItemsHold(root, branch, value))) return false;
  }
  if (Array.isArray(value)) {
    if (schema.uniqueItems === true) {
      const seen = new Set<string>();
      for (const item of value) {
        const key = canonical(item);
        if (seen.has(key)) return false;
        seen.add(key);
      }
    }
    if (schema.items !== undefined) return value.every((item) => uniqueItemsHold(root, schema.items, item));
    return true;
  }
  if (isNode(value) && isNode(schema.properties)) {
    const properties = schema.properties;
    return Object.keys(value).every((key) => !(key in properties) || uniqueItemsHold(root, properties[key], value[key]));
  }
  return true;
}
