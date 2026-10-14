import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Bpic19ProfileAnswer, Bpic19ProfileRequest } from "../generated/bpic19-profile";
import fixtures from "./profile-extension-test-answers.json";
import { Bpic19Profile } from "./Bpic19Profile";
import { bpic19ProfileContract, type Bpic19ProfileClient, type Bpic19ProfileOutcome } from "./profile-client";

function answer(request: Bpic19ProfileRequest): Bpic19ProfileAnswer {
  const value = request.query.attribute_view?.select_value ? fixtures.selected : request.query.attribute_view?.offset === 12 ? fixtures.last : fixtures.first;
  const candidate: unknown = { ...structuredClone(value), request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, identity: request.identity, query: request.query };
  if (!bpic19ProfileContract.answer(candidate)) throw new Error("Literal profile fixture violates its boundary");
  return candidate;
}
function initial() {
  const request = { ...fixtures.first, message_type: "bpic19_profile_request" };
  if (!bpic19ProfileContract.request({schema_version:1,message_type:"bpic19_profile_request",request_id:request.request_id,query_revision:request.query_revision,workspace_id:request.workspace_id,identity:request.identity,query:request.query})) throw new Error("Invalid literal query");
  const candidate:unknown=fixtures.first;
  if(!bpic19ProfileContract.answer(candidate))throw new Error("Invalid literal first answer");
  return candidate;
}

it("pages to an omitted singleton, reviews exact raw-value membership, keeps the complete item and opens its one witness",async()=>{
  const fixture=initial(),onKeep=vi.fn(),onInspect=vi.fn(),onReviewed=vi.fn();
  const client:Bpic19ProfileClient={profile:vi.fn(async (request):Promise<Bpic19ProfileOutcome>=>({ok:true,answer:answer(request)}))};
  render(<Bpic19Profile workspaceId={fixture.workspace_id} identity={fixture.identity} revision={1} query={fixture.query} client={client} onKeep={onKeep} onInspect={onInspect} onReviewed={onReviewed}/>);
  const user=userEvent.setup();await screen.findByText("13 PO items");
  await user.click(screen.getByText("Case attributes and source grain"));
  await user.click(screen.getByText(/event reviewed attribute: 13 values/));
  await user.click(screen.getByRole("button",{name:"Next values for column 10: event reviewed attribute"}));
  await screen.findByText(/z-singleton: 1 items, 1 records, 1 documents/);
  await user.click(screen.getByRole("button",{name:"Review complete-item membership for z-singleton"}));
  await screen.findByText(/Reviewed exact raw value "z-singleton": 1 complete items/);
  await user.click(screen.getByRole("button",{name:"Keep reviewed attribute-value items"}));
  expect(onKeep).toHaveBeenCalledWith({kind:"case_id_in",case_ids:["D12_1"],negate:false},expect.objectContaining({group:{kind:"attribute_value",column_index:10,value:"z-singleton"},query:expect.objectContaining({attribute_view:expect.objectContaining({select_value:true,value:"z-singleton"})})}));
  await user.click(screen.getByRole("button",{name:"Inspect attribute witness D12_1"}));
  expect(onInspect).toHaveBeenCalledWith("D12_1",fixtures.selected.profile.attribute_view.selection.witnesses[0].row_ids);
  expect(screen.getByText("13 PO items")).toBeTruthy();
  expect(onReviewed).toHaveBeenCalledTimes(3);
});

it("shows known zero subtype cells, column totals and three separately labeled reported populations",async()=>{
  const fixture=initial();const client:Bpic19ProfileClient={profile:async request=>({ok:true,answer:answer(request)})};
  render(<Bpic19Profile workspaceId={fixture.workspace_id} identity={fixture.identity} revision={1} query={fixture.query} client={client} onKeep={vi.fn()} onInspect={vi.fn()}/>);
  const user=userEvent.setup();const table=await screen.findByRole("table",{name:/Item Type subgroups/});
  const standard=within(table).getByRole("row",{name:/Standard/});
  expect(within(standard).getAllByRole("cell")[0].textContent).toBe("0");
  await user.click(screen.getByText(/Item Type column totals/));
  expect(await screen.findByRole("table",{name:"Invariant Item Type totals"})).toBeTruthy();
  await user.click(screen.getByText(/Source scope and observation review/));
  const claims=screen.getByRole("table",{name:/Reported populations/});
  expect(claims.textContent).toContain("190,283");expect(claims.textContent).toContain("189,584");expect(claims.textContent).toContain("699");
  expect(claims.textContent).toContain("reported source claim");
});

it("emits named overlapping flag intents using the exact reviewed original columns and pauses them for changed roles",async()=>{
  const fixture=initial(),onKeepRecordPredicate=vi.fn(),onKeep=vi.fn();
  const client:Bpic19ProfileClient={profile:async request=>({ok:true,answer:answer(request)})};
  render(<Bpic19Profile workspaceId={fixture.workspace_id} identity={fixture.identity} revision={1} query={fixture.query} client={client}
    onKeep={onKeep} onKeepRecordPredicate={onKeepRecordPredicate} onInspect={vi.fn()}/>);
  const user=userEvent.setup();await screen.findByText("13 PO items");
  await user.click(screen.getByText("Historical flag-only views · overlapping purchasing flows"));
  expect(screen.getByText(/IV=false alone additionally includes two-way items/)).toBeTruthy();
  await user.click(screen.getByRole("button",{name:"Keep overlapping GR=true AND IV=false items"}));
  expect(onKeepRecordPredicate).toHaveBeenLastCalledWith({kind:"record_attributes_all",policy_id:"incident.raw.same_record_all.v1",negate:false,
    conditions:[{column_index:fixture.profile!.definition.roles.goods_receipt,values:["true"]},{column_index:fixture.profile!.definition.roles.gr_based_iv,values:["false"]}]});
  await user.click(screen.getByRole("button",{name:"Keep overlapping IV=false items"}));
  expect(onKeepRecordPredicate).toHaveBeenLastCalledWith({kind:"record_attributes_all",policy_id:"incident.raw.same_record_all.v1",negate:false,
    conditions:[{column_index:fixture.profile!.definition.roles.gr_based_iv,values:["false"]}]});
  expect(onKeep).not.toHaveBeenCalled(); // Typed category membership is not fabricated for a raw predicate.
  await user.click(screen.getByText("Reviewed source field roles"));
  await user.selectOptions(screen.getByRole("combobox",{name:"Goods Receipt setting"}),String(fixture.profile!.definition.roles.gr_based_iv));
  expect(screen.getByRole("button",{name:"Keep overlapping GR=true AND IV=false items"}).hasAttribute("disabled")).toBe(true);
  await user.click(screen.getByRole("button",{name:"Keep overlapping IV=false items"}));
  expect(onKeepRecordPredicate).toHaveBeenCalledTimes(2);
});
