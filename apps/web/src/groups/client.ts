import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/rule-groups.schema.json";
import { sameJson } from "../data/coordinator";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import type { RuleGroupsAnswer, RuleGroupsRefusal, RuleGroupsRequest } from "../generated/rule-groups";

export type RuleGroupsProblem =
  | { kind: "refusal"; refusal: RuleGroupsRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type RuleGroupsOutcome = { ok: true; answer: RuleGroupsAnswer } | { ok: false; problem: RuleGroupsProblem };
export interface RuleGroupsClient {
  groups(request: RuleGroupsRequest, signal: AbortSignal): Promise<RuleGroupsOutcome>;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, formats: { "date-time": true } });
ajv.addSchema(withoutUniqueItems(schema));
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The rule-groups contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(schema, { $ref: `#/$defs/${definition}` }, value);
}
export const ruleGroupsContract = {
  request: check<RuleGroupsRequest>("RuleGroupsRequest"),
  answer: check<RuleGroupsAnswer>("RuleGroupsAnswer"),
  refusal: check<RuleGroupsRefusal>("RuleGroupsRefusal"),
};

/** Groups answer exactly the identity, revision and query they were asked for. */
export function answersRuleGroups(request: RuleGroupsRequest, answer: RuleGroupsAnswer): boolean {
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision &&
    answer.workspace_id === request.workspace_id && sameJson(answer.identity, request.identity) && sameJson(answer.query, request.query);
}

export const httpRuleGroupsClient: RuleGroupsClient = {
  async groups(request, signal) {
    let response: Response;
    try {
      response = await fetch("/api/investigations/rule-groups", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request), signal, cache: "no-store",
      });
    } catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (ruleGroupsContract.refusal(value) && value.operation === "rule_groups" &&
        (value.request_id === null || value.request_id === request.request_id) &&
        (value.query_revision === null || value.query_revision === request.query_revision) &&
        (value.workspace_id === null || value.workspace_id === request.workspace_id)) {
      return { ok: false, problem: { kind: "refusal", refusal: value } };
    }
    if (response.ok && ruleGroupsContract.answer(value) && answersRuleGroups(request, value)) return { ok: true, answer: value };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer these groups and identity." } };
  },
};
