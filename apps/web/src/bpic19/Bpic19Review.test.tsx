import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {Bpic19Review} from "./Bpic19Review";
import {bpic19Contract,type Bpic19Client} from "./scoring-client";
import type {Bpic19ScoreAnswer} from "./scoring-types";
import fixture from "./scoring-fixtures/native-two-items.json";
function answer():Bpic19ScoreAnswer{const raw:unknown=structuredClone(fixture);if(!bpic19Contract.answer(raw))throw Error("Invalid native fixture");return raw;}
it("records supplied flags and distinct evidence stages without filling causal or outcome claims",async()=>{
 const reviewed=vi.fn(),valid=vi.fn();const c:Bpic19Client={score:vi.fn(),read:vi.fn(),review:vi.fn(async request=>({ok:true as const,answer:{...answer(),request_id:request.request_id,query_revision:request.query_revision}}))};
 render(<Bpic19Review answer={answer()} client={c} onReviewed={reviewed} onValidityChange={valid}/>);
 expect(screen.getByLabelText("Adoption status")).toHaveProperty("value","unknown");expect(screen.getByLabelText("Tested outcome status")).toHaveProperty("value","untested");
 fireEvent.change(screen.getByLabelText("Mandatory control C01"),{target:{value:"true"}});
 fireEvent.change(screen.getByLabelText("Control rationale C01"),{target:{value:"Owner supplied statutory control"}});
 fireEvent.change(screen.getByLabelText("Finding title"),{target:{value:"Investigate invoice ageing"}});
 fireEvent.change(screen.getByLabelText("Observation status"),{target:{value:"observed"}});
 fireEvent.change(screen.getByLabelText("Observation note"),{target:{value:"Timing has a positive signed driver"}});
 fireEvent.click(screen.getByRole("button",{name:"Add finding to review"}));fireEvent.click(screen.getByRole("button",{name:"Freeze analyst review"}));await waitFor(()=>expect(reviewed).toHaveBeenCalledTimes(1));
 expect(c.review).toHaveBeenCalledWith(expect.objectContaining({run_id:answer().run_id,review:expect.objectContaining({mandatory_controls:[expect.objectContaining({criterion_id:"C01",mandatory:true})],findings:[expect.objectContaining({observation:expect.objectContaining({status:"observed"}),adoption:expect.objectContaining({status:"unknown"}),tested_outcome:expect.objectContaining({status:"untested"})})]})}),expect.any(AbortSignal));
 expect(c.score).not.toHaveBeenCalled();expect(valid).toHaveBeenLastCalledWith(true);
});
