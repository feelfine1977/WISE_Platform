import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Bpic19Scoring, type Bpic19ScoringSubject } from "./Bpic19Scoring";
import { bpic19Contract, localBpic19Client, type Bpic19Client, type Bpic19Outcome } from "./scoring-client";
import type { Bpic19ScoreAnswer, Bpic19ScoreRequest, ExposureReview } from "./scoring-types";
import fixture from "./scoring-fixtures/native-two-items.json";
function literal(): Bpic19ScoreAnswer {
  const value: unknown = structuredClone(fixture);
  if (!bpic19Contract.answer(value)) throw new Error("The native fixture must satisfy the actual contract");
  return value;
}
const base = literal();
const subject: Bpic19ScoringSubject = {workspace_id: base.workspace_id, base_identity: base.base_identity,
  named_population: base.named_population, roles: {item_category: 3, resource: 5, net_worth: 7}};
const eur: ExposureReview = {definition_id: `bpic19-measure-definition.v1:sha256:${"a".repeat(64)}`, identity: base.named_population.identity,
  query: {policy_id: "bpic19.source_witnessed_measures.v1", measure_profile:"paper_v1",roles:subject.roles,offset:0,limit:1,
    value_reducer:"unique_creation_value",value_unit:"EUR",calibration_population:"parent"}};
const usd: ExposureReview = {...eur,definition_id:`bpic19-measure-definition.v1:sha256:${"b".repeat(64)}`,query:{...eur.query,value_unit:"USD"}};
function request(review?:ExposureReview): Bpic19ScoreRequest {
  return {schema_version:1,message_type:"bpic19_score_request",request_id:base.request_id,query_revision:base.query_revision,
    workspace_id:base.workspace_id,base_identity:base.base_identity,named_population:base.named_population,roles:subject.roles,
    settings:{profile:"paper",criteria_family:"full",view:"Balanced",mode:"flat",gamma:0,group_by:["company","spend_area"],min_cases:1,volume:"exposure",exposure_policy:"creation_unique_value"},case_offset:0,case_limit:50,...(review?{exposure_review:review}:{})};
}
function answered(sent: Bpic19ScoreRequest): Bpic19ScoreAnswer {
  const answer=literal();
  const {profile: _profile, exposure_policy: _policy, ...nativeSettings} = sent.settings;
  return {...answer,request_id:sent.request_id,query_revision:sent.query_revision,
    definition:{roles:sent.roles,...(sent.exposure_review?{exposure_review:{...sent.exposure_review,query:{...sent.exposure_review.query,offset:0,limit:1}}}:{})},
    report:{...answer.report,settings:{...answer.report.settings,...nativeSettings},
      exposure_calibration:{policy:sent.settings.exposure_policy,source_field:7,source_column_name:"original amount",source_unit:sent.exposure_review?.query.value_unit,
        unit_provenance:"explicit_raw_measures_definition.v1",value_reducer:sent.exposure_review?.query.value_reducer,
        priority_unit:`${sent.exposure_review?.query.value_unit}-score units`,reviewed_measure_definition_id:sent.exposure_review?.definition_id,calibration_id:"frozen"}}};
}
function chooseReview(index="0") {
  fireEvent.change(screen.getByLabelText("Priority multiplier"),{target:{value:"exposure"}});
  fireEvent.change(screen.getByLabelText("Reviewed value definition"),{target:{value:index}});
}
afterEach(()=>vi.unstubAllGlobals());
describe("Explicit reviewed exposure native handoff",()=>{
  it("requires and consumes the distinct reviewed panel first-source recipe",async()=>{
    const panel:ExposureReview={...eur,definition_id:`bpic19-measure-definition.v1:sha256:${"c".repeat(64)}`,
      query:{...eur.query,value_reducer:"first_creation_source_position"}};
    const client:Bpic19Client={score:vi.fn<Bpic19Client["score"]>(async sent=>({ok:true,answer:answered(sent)})),read:vi.fn()};
    render(<Bpic19Scoring subject={subject} client={client} exposureReviews={[eur,panel]} />);
    fireEvent.change(screen.getByLabelText("Priority multiplier"),{target:{value:"exposure"}});
    fireEvent.change(screen.getByLabelText("Exposure recipe"),{target:{value:"creation_first_source_position"}});
    expect(screen.getByRole("button",{name:"Run analysis"})).toHaveProperty("disabled",true);
    fireEvent.change(screen.getByLabelText("Reviewed value definition"),{target:{value:"1"}});
    fireEvent.click(screen.getByRole("button",{name:"Run analysis"}));
    await screen.findByText(/Reviewed panel occurrence choice/);
    expect(client.score).toHaveBeenCalledWith(expect.objectContaining({exposure_review:panel,
      settings:expect.objectContaining({volume:"exposure",exposure_policy:"creation_first_source_position"})}),expect.any(AbortSignal));
  });

  it("requires a declared review for new unit-aware browser exposure but leaves item-count usable",()=>{
    const client:Bpic19Client={score:vi.fn(),read:vi.fn()};
    render(<Bpic19Scoring subject={subject} client={client} />);
    expect(screen.getByRole("button",{name:"Run analysis"})).toHaveProperty("disabled",false);
    fireEvent.change(screen.getByLabelText("Priority multiplier"),{target:{value:"exposure"}});
    expect(screen.getByRole("button",{name:"Run analysis"})).toHaveProperty("disabled",true);
    expect(screen.getByText(/Review the original value column, unit and reducer/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Priority multiplier"),{target:{value:"cases"}});
    expect(screen.getByRole("button",{name:"Run analysis"})).toHaveProperty("disabled",false);
    expect(client.score).not.toHaveBeenCalled();
  });
  it("sends only the exact chosen raw-measures reference and shows verified raw and priority units",async()=>{
    const client:Bpic19Client={score:vi.fn<Bpic19Client["score"]>(async sent=>({ok:true,answer:answered(sent)})),read:vi.fn()};
    render(<Bpic19Scoring subject={subject} client={client} exposureReviews={[eur,usd]} />);
    chooseReview();fireEvent.click(screen.getByRole("button",{name:"Run analysis"}));
    await screen.findByText(/Priority unit EUR-score units/);
    expect(client.score).toHaveBeenCalledWith(expect.objectContaining({exposure_review:eur,settings:expect.objectContaining({volume:"exposure",exposure_policy:"creation_unique_value"})}),expect.any(AbortSignal));
    expect(screen.getByText(/original amount.*column 7.*reviewed unit EUR/)).toBeTruthy();
    expect(screen.queryByText(/Priority unit USD-score/)).toBeNull();
  });
  it("drops the old pending EUR answer when another reviewed unit is explicitly selected",async()=>{
    let resolve:((outcome:Bpic19Outcome)=>void)|undefined,sent:Bpic19ScoreRequest|undefined;
    const client:Bpic19Client={score:vi.fn<Bpic19Client["score"]>(req=>{sent=req;return new Promise(r=>{resolve=r;});}),read:vi.fn()};
    const valid=vi.fn(),reviewed=vi.fn();
    render(<Bpic19Scoring subject={subject} client={client} exposureReviews={[eur,usd]} onValidityChange={valid} onReviewed={reviewed} />);
    chooseReview();fireEvent.click(screen.getByRole("button",{name:"Run analysis"}));
    const signal=vi.mocked(client.score).mock.calls[0][1];
    fireEvent.change(screen.getByLabelText("Reviewed value definition"),{target:{value:"1"}});expect(signal.aborted).toBe(true);
    if(!resolve||!sent)throw new Error("expected a pending request");
    await act(async()=>resolve?.({ok:true,answer:answered(sent!)}));
    expect(screen.queryByText(/items scored/)).toBeNull();expect(reviewed).not.toHaveBeenCalled();expect(valid).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button",{name:"Run analysis"})).toHaveProperty("disabled",false);
  });
  it("refuses a mock/client answer for another reviewed recipe before retaining it",async()=>{
    const reviewed=vi.fn();
    const client:Bpic19Client={score:vi.fn<Bpic19Client["score"]>(async sent=>({ok:true,answer:answered({...sent,exposure_review:usd})})),read:vi.fn()};
    render(<Bpic19Scoring subject={subject} client={client} exposureReviews={[eur]} onReviewed={reviewed} />);
    chooseReview();fireEvent.click(screen.getByRole("button",{name:"Run analysis"}));
    await screen.findByText(/another reviewed value recipe, unit or population/);
    expect(reviewed).not.toHaveBeenCalled();expect(screen.queryByText(/items scored/)).toBeNull();
  });
  it("restores frozen reviewed meaning without substituting a current measures option",()=>{
    const client:Bpic19Client={score:vi.fn(),read:vi.fn()};
    render(<Bpic19Scoring subject={subject} client={client} initialRun={answered(request(eur))} exposureReviews={[usd]} readOnly />);
    expect(screen.getByText(/Priority unit EUR-score units/)).toBeTruthy();
    expect(screen.queryByLabelText("Reviewed value definition")).toBeNull();expect(client.score).not.toHaveBeenCalled();
  });
  it("keeps old generic frozen reports honest without a currency fallback",()=>{
    const old=literal();old.report.settings.volume="exposure";old.report.exposure_calibration={policy:"creation_unique_value",unit:"source_value_units"};
    render(<Bpic19Scoring subject={subject} initialRun={old} exposureReviews={[eur]} readOnly />);
    expect(screen.getByText(/No currency or original value-field unit was verified/)).toBeTruthy();expect(screen.queryByText(/reviewed unit EUR/)).toBeNull();
  });
  it("enforces closed references and client fences while ignoring only presentation paging",async()=>{
    const sent=request({...eur,query:{...eur.query,offset:100,limit:5}});
    expect(bpic19Contract.request({...sent,exposure_review:{...eur,amounts:[10]}})).toBe(false);
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify(answered(sent)),{status:200})));
    expect((await localBpic19Client.score(sent,new AbortController().signal)).ok).toBe(true);
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify(answered({...sent,exposure_review:usd})),{status:200})));
    const wrong=await localBpic19Client.score(sent,new AbortController().signal);expect(wrong.ok).toBe(false);
    if(!wrong.ok)expect(wrong.message).toContain("another reviewed exposure definition");
  });
});

it("opens the complete original item at exact value contribution witnesses",async()=>{
  const inspect=vi.fn();
  const client:Bpic19Client={score:vi.fn<Bpic19Client["score"]>(async sent=>{
    const answer=answered(sent);
    answer.report.case_page.cases[0].value_evidence={creation_value:{available:true,value:10,unit:"EUR",row_ids:["original-creation-A"],reason:null}};
    return {ok:true,answer};
  }),read:vi.fn()};
  render(<Bpic19Scoring subject={subject} client={client} exposureReviews={[eur]} onInspect={inspect} />);
  chooseReview();fireEvent.click(screen.getByRole("button",{name:"Run analysis"}));
  await screen.findByText(/items scored/);fireEvent.click(screen.getByRole("button",{name:/^A$/}));
  expect(screen.getByText("Original value contributions for A")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Inspect creation value original values"}));
  expect(inspect).toHaveBeenCalledWith("A",["original-creation-A"]);
});

it("refuses another unit recipe in a frozen member page even when its run ID is unchanged",async()=>{
  const frozen=answered(request(eur));
  const client:Bpic19Client={score:vi.fn(),read:vi.fn<Bpic19Client["read"]>(async page=>({ok:true,answer:{...answered(request(usd)),request_id:page.request_id,query_revision:page.query_revision,run_id:frozen.run_id}}))};
  render(<Bpic19Scoring subject={subject} client={client} initialRun={frozen} readOnly />);
  fireEvent.click(screen.getByRole("button",{name:"Inspect members of A · Parts"}));
  await screen.findByText(/another reviewed value recipe, unit or population/);
  expect(screen.getByText(/Priority unit EUR-score units/)).toBeTruthy();expect(client.score).not.toHaveBeenCalled();
});
