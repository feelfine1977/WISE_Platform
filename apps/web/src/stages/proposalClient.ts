import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/stage-proposal.schema.json";
import { sameJson } from "../data/coordinator";
import type { StageProposalAnswer, StageProposalRefusal, StageProposalRequest } from "../generated/stage-proposal";

export type ProposalProblem =
  | { kind: "refusal"; refusal: StageProposalRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type ProposalOutcome = { ok: true; answer: StageProposalAnswer } | { ok: false; problem: ProposalProblem };
export interface ProposalClient {
  propose(request: StageProposalRequest, signal: AbortSignal): Promise<ProposalOutcome>;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(schema);
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The stage proposal contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) === true;
}
export const proposalContract = {
  request: check<StageProposalRequest>("StageProposalRequest"),
  answer: check<StageProposalAnswer>("StageProposalAnswer"),
  refusal: check<StageProposalRefusal>("StageProposalRefusal"),
};

/** A reply must answer this exact request, revision, identity and column: a late reply for another choice is not one. */
export function answersProposal(request: StageProposalRequest, answer: StageProposalAnswer): boolean {
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision && answer.workspace_id === request.workspace_id &&
    sameJson(answer.identity, request.identity) && answer.column_index === request.column_index;
}

export const httpProposalClient: ProposalClient = {
  async propose(request, signal) {
    let response: Response;
    try {
      response = await fetch("/api/investigations/stage-proposal", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request), signal, cache: "no-store",
      });
    } catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (proposalContract.refusal(value) && value.operation === "stage_proposal" &&
        (value.request_id === null || value.request_id === request.request_id) && (value.query_revision === null || value.query_revision === request.query_revision)) {
      return { ok: false, problem: { kind: "refusal", refusal: value } };
    }
    if (response.ok && proposalContract.answer(value) && answersProposal(request, value)) return { ok: true, answer: value };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer these values and identity." } };
  },
};
