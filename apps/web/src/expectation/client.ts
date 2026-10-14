import Ajv2020 from "ajv/dist/2020.js";
import scoringSchema from "../../../../contracts/scoring.schema.json";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import type {
  ExpectationValidationAnswer,
  ScoreCaseWitnessAnswer,
  ScoreCaseWitnessRequest,
  ScoreExpectationRequest,
  ReadScoreRunRequest,
  ScoreRunAnswer,
  ScoringRefusal,
  ValidateExpectationRequest,
} from "../generated/scoring";

export const scoringRoutes = {
  validate: "/api/expectations/validate",
  score: "/api/expectations/score",
  readRun: "/api/expectations/read-run",
  caseWitness: "/api/expectations/case-witness",
} as const;

/**
 * Why a check, a score or a witness produced no answer: a typed refusal from the local service, or
 * a failure this screen detected. It is always shown as a failure, never as an empty answer.
 */
export type ScoringProblem =
  | { kind: "refusal"; refusal: ScoringRefusal }
  | { kind: "unreachable" }
  | { kind: "http"; status: number }
  | { kind: "unsupported_reply"; detail: string };

export type ScoringOutcome<T> = { ok: true; answer: T } | { ok: false; problem: ScoringProblem };

export interface ScoringClient {
  /** Reads an immutable stored run; never validates or scores a definition. */
  readRun?(request: ReadScoreRunRequest, signal: AbortSignal): Promise<ScoringOutcome<ScoreRunAnswer>>;
  validate(request: ValidateExpectationRequest, signal: AbortSignal): Promise<ScoringOutcome<ExpectationValidationAnswer>>;
  score(request: ScoreExpectationRequest, signal: AbortSignal): Promise<ScoringOutcome<ScoreRunAnswer>>;
  caseWitness(request: ScoreCaseWitnessRequest, signal: AbortSignal): Promise<ScoringOutcome<ScoreCaseWitnessAnswer>>;
}

type ContractCheck<T> = (value: unknown) => value is T;

// UTC instants are also constrained by a pattern, so the format keyword adds no check here.
// Duplicate items are checked separately, in one pass, so that large runs stay quick.
// The contract's conditions (a ready answer has no blocker, an unevaluable sequence names its
// incidents) constrain properties whose types are stated once, beside them; they are checked as written.
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strictTypes: false, formats: { "date-time": true } });
ajv.addSchema(withoutUniqueItems(scoringSchema));

function validator<T>(definition: string): ContractCheck<T> {
  const validate = ajv.getSchema<T>(`${scoringSchema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The scoring contract has no definition ${definition}.`);
  const reference = { $ref: `#/$defs/${definition}` };
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(scoringSchema, reference, value);
}

export const scoringContract = {
  validateRequest: validator<ValidateExpectationRequest>("ValidateExpectationRequest"),
  validationAnswer: validator<ExpectationValidationAnswer>("ExpectationValidationAnswer"),
  scoreRequest: validator<ScoreExpectationRequest>("ScoreExpectationRequest"),
  readRunRequest: validator<ReadScoreRunRequest>("ReadScoreRunRequest"),
  scoreRunAnswer: validator<ScoreRunAnswer>("ScoreRunAnswer"),
  witnessRequest: validator<ScoreCaseWitnessRequest>("ScoreCaseWitnessRequest"),
  witnessAnswer: validator<ScoreCaseWitnessAnswer>("ScoreCaseWitnessAnswer"),
  refusal: validator<ScoringRefusal>("ScoringRefusal"),
};

const artifact = scoringSchema.$defs.MethodArtifact.properties;

/** The one build of the method library the scoring contract admits, as the contract names it. */
export const contractMethodBuild = {
  distribution: artifact.distribution.const,
  version: artifact.version.const,
  sourceCommit: artifact.source_commit.const,
  eligibleRelease: artifact.eligible_release.const as boolean,
};

async function postJson<T>(
  route: string,
  body: unknown,
  operation: ScoringRefusal["operation"],
  validateAnswer: ContractCheck<T>,
  signal: AbortSignal,
): Promise<ScoringOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch {
    return { ok: false, problem: { kind: "unreachable" } };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  if (scoringContract.refusal(payload) && payload.operation === operation) {
    return { ok: false, problem: { kind: "refusal", refusal: payload } };
  }
  if (!response.ok) return { ok: false, problem: { kind: "http", status: response.status } };
  if (validateAnswer(payload)) return { ok: true, answer: payload };
  return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not match the scoring contract." } };
}

export const httpScoringClient: ScoringClient = {
  readRun: (request, signal) => postJson(scoringRoutes.readRun, request, "read_score_run", scoringContract.scoreRunAnswer, signal),
  validate: (request, signal) => postJson(scoringRoutes.validate, request, "validate_expectation", scoringContract.validationAnswer, signal),
  score: (request, signal) => postJson(scoringRoutes.score, request, "score_expectation", scoringContract.scoreRunAnswer, signal),
  caseWitness: (request, signal) =>
    postJson(scoringRoutes.caseWitness, request, "score_case_witness", scoringContract.witnessAnswer, signal),
};
