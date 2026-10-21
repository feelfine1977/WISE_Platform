import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {describe,expect,it,vi} from "vitest";
import {Bpic19Associations} from "./Bpic19Associations";
import {bpic19Contract,type Bpic19Client,type Bpic19Outcome} from "./scoring-client";
import type {Bpic19AssociationRequest,Bpic19ScoreAnswer} from "./scoring-types";
import fixture from "./scoring-fixtures/native-association-seven-items.json";
function answer():Bpic19ScoreAnswer {const raw:unknown=structuredClone(fixture);if(!bpic19Contract.answer(raw))throw Error("Native HTTP fixture invalid");return raw;}
function client():Bpic19Client{return {score:vi.fn(),read:vi.fn(),associate:vi.fn(async request=>({ok:true as const,answer:{...answer(),request_id:request.request_id,query_revision:request.query_revision}}))};}
describe("Frozen native association review",()=>{
 it("restores the exact reviewed memberships, exposes literal denominators and inspects frozen pair members",async()=>{
  const c=client(),members=vi.fn(),reviewed=vi.fn();render(<Bpic19Associations answer={answer()} client={c} revision={31} onReviewed={reviewed} onMembers={members}/>);
  expect(screen.getByLabelText("Target population")).toHaveProperty("value","saved");
  expect(screen.getByLabelText("Pair universe")).toHaveProperty("value","jointly_eligible");
  expect(screen.getByText(/native penalty mass 1.875/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Inspect intersection"}));
  expect(members).toHaveBeenCalledWith({association_set:{population:"target",state:"all",pair:{left:"A",right:"B",set:"intersection"}}});
  fireEvent.click(screen.getByRole("button",{name:"Compare frozen criteria"}));await waitFor(()=>expect(reviewed).toHaveBeenCalledTimes(1));
  expect(c.associate).toHaveBeenCalledWith(expect.objectContaining({run_id:answer().run_id,query_revision:31,query:expect.objectContaining({target:{name:"Target T",selector:{kind:"case_ids",case_ids:["t1","t2","t3","t4","t5"]}},pair_mode:"jointly_eligible"})}),expect.any(AbortSignal));
 });
 it("separately reviews the legacy convention and discards answers after a meaning change",async()=>{
  let resolve:((outcome:Bpic19Outcome)=>void)|undefined;let sent:Bpic19AssociationRequest|undefined;const c=client();c.associate=vi.fn(request=>{sent=request;return new Promise<Bpic19Outcome>(r=>{resolve=r;});});const reviewed=vi.fn(),valid=vi.fn();
  render(<Bpic19Associations answer={answer()} client={c} onReviewed={reviewed} onValidityChange={valid} onMembers={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText("Pair universe"),{target:{value:"legacy_total_case"}});expect(valid).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole("button",{name:"Compare frozen criteria"}));expect(sent?.query.pair_mode).toBe("legacy_total_case");
  fireEvent.change(screen.getByLabelText("Reviewed minimum support"),{target:{value:"2"}});
  await act(async()=>resolve?.({ok:true,answer:answer()}));expect(reviewed).not.toHaveBeenCalled();
  expect(screen.getByText(/Association settings changed/)).toBeTruthy();expect(c.score).not.toHaveBeenCalled();
 });
});

it("offers the exact paper all-eligible DF2 Packaging comparison without changing the native run",async()=>{
 const raw:unknown=structuredClone((await import("./scoring-fixtures/native-two-items.json")).default);
 if(!bpic19Contract.answer(raw))throw Error("Invalid native paper fixture");
 const c=client();c.associate=vi.fn(async()=>({ok:false as const,message:"Literal request recorded"}));
 render(<Bpic19Associations answer={raw} client={c} onReviewed={vi.fn()} onMembers={vi.fn()}/>);
 fireEvent.change(screen.getByLabelText("Target population"),{target:{value:"paper_packaging_df2"}});
 expect(screen.getByLabelText("Comparator population")).toHaveProperty("value","paper_outside_packaging_df2");
 fireEvent.click(screen.getByRole("button",{name:"Compare frozen criteria"}));
 await screen.findByRole("alert");
 expect(c.associate).toHaveBeenCalledWith(expect.objectContaining({run_id:raw.run_id,query:expect.objectContaining({criteria:["C04"],target:expect.objectContaining({selector:{kind:"group",group_values:{spend_area:"Packaging",flow:"DF2"}}}),comparator:expect.objectContaining({selector:{kind:"group",group_values:{flow:"DF2"},exclude_group_values:{spend_area:"Packaging"}}})})}),expect.any(AbortSignal));
 expect(c.score).not.toHaveBeenCalled();
});
