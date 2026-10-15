import {act,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,expect,it,vi} from "vitest";
import fixture from "../test/prepared-api.json";
import {Bpic19PreparedAssessmentBridge} from "./Bpic19PreparedAssessmentBridge";
import {PreparedAssessmentSession} from "./prepared-session";

afterEach(()=>vi.unstubAllGlobals());
function setup(){
  const session=new PreparedAssessmentSession();session.basis({workspace_id:fixture.review.workspace_id,source_context_id:"declared-prepared",revision:1},true);
  const fetcher=vi.fn(async(_url:string,options:RequestInit)=>{
    const request=JSON.parse(String(options.body));
    return new Response(JSON.stringify({...fixture.review,request_id:request.request_id,query_revision:request.query_revision,workspace_id:request.workspace_id, input:{...fixture.review.input,rows:request.rows}}),{headers:{"Content-Type":"application/json"}});
  });
  vi.stubGlobal("fetch",fetcher);
  return {...render(<Bpic19PreparedAssessmentBridge session={session}/>),session,fetcher,user:userEvent.setup()};
}
it("reviews explicit declared JSON through the public API and refuses an incomplete numeric edit without manufacturing zero",async()=>{
  const {session,fetcher,user}=setup();
  expect(screen.getByRole("textbox",{name:"Declared measurement JSON"}).textContent).toBe("");
  fireEvent.change(screen.getByRole("textbox",{name:"Declared measurement JSON"}),{target:{value:JSON.stringify({rows:fixture.review.input.rows})}});
  await user.click(screen.getByRole("button",{name:"Open declared JSON draft"}));
  const grid=screen.getByRole("table",{name:/Declared prepared attributes for/});
  expect(within(grid).getAllByRole("row")).toHaveLength(30);
  await user.click(screen.getByRole("button",{name:"Review declared measurements"}));
  await screen.findByText("Authoritative review received. Choose a view and request Run.");
  expect(fetcher.mock.calls[0][0]).toBe("/api/investigations/bpic19-prepared/review");
  const first=screen.getByRole("textbox",{name:"Value for c_l1_invoice_present"});
  fireEvent.change(first,{target:{value:""}});
  await user.click(screen.getByRole("button",{name:"Review declared measurements"}));
  expect(screen.getByRole("alert").textContent).toContain("finite JSON number");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button",{name:"Run Finance assessment"}).hasAttribute("disabled")).toBe(true);
  expect(session.readyForSave()).toBe(false);
});

it("shows supplied partial coverage as unavailable, keeps exact penalties and retains the separate native reference",async()=>{
  const {session,fetcher,user}=setup();
  fetcher.mockImplementation(async(url,options)=>{
    const request=JSON.parse(String(options.body));
    const payload=url.endsWith("/run")?{...fixture.run,cases:fixture.run.cases.map((item,index)=>index?item:{...item,score:0.375,score_state:"partial_evidence",coverage:null,coverage_state:"partial_not_qualified"})}:fixture.review;
    return new Response(JSON.stringify({...payload,request_id:request.request_id,query_revision:request.query_revision,workspace_id:request.workspace_id}),{headers:{"Content-Type":"application/json"}});
  });
  fireEvent.change(screen.getByRole("textbox",{name:"Declared measurement JSON"}),{target:{value:JSON.stringify({rows:fixture.review.input.rows})}});
  await user.click(screen.getByRole("button",{name:"Open declared JSON draft"}));
  await user.click(screen.getByRole("button",{name:"Review declared measurements"}));
  await screen.findByText("Authoritative review received. Choose a view and request Run.");
  await user.click(screen.getByRole("button",{name:"Run Finance assessment"}));
  await screen.findByText("Native result received for the exact reviewed input.");
  expect(screen.getByText("Unavailable: partial_not_qualified")).toBeTruthy();
  expect(screen.getByText("0.375 native_score")).toBeTruthy();
  expect(screen.getByText(/Packed unreleased Method artifact/)).toBeTruthy();
  await user.click(screen.getByRole("button",{name:"Request retain of "+fixture.run.reference.run_id}));
  expect(session.savedPreparedAssessments()).toEqual([fixture.run.reference]);
  const runRequest=JSON.parse(String(fetcher.mock.calls.find(call=>call[0].endsWith("/run"))![1].body));
  expect(runRequest.input_id).toBe(fixture.review.input.content_id);
  expect(runRequest).not.toHaveProperty("identity");expect(runRequest).not.toHaveProperty("norm_document");
});

it("reopens declaration bytes and native results with public read and export only, then exports the retained reference",async()=>{
  const {session,fetcher,user}=setup();
  const formats:string[]=[];
  fetcher.mockImplementation(async(url,options)=>{
    const request=JSON.parse(String(options.body));
    if(url.endsWith("/read"))return new Response(JSON.stringify({...fixture.run,message_type:"bpic19_prepared_read_answer",request_id:request.request_id,query_revision:request.query_revision,workspace_id:request.workspace_id}),{headers:{"Content-Type":"application/json"}});
    if(url.endsWith("/export")){
      formats.push(request.format);
      return new Response(JSON.stringify({format:"bpic19.declared-prepared-export.v1",reference:fixture.run.reference,input:fixture.review.input,output:{}}),{headers:{"Content-Type":"application/json","Content-Disposition":'attachment; filename="prepared-finance.json"'}});
    }
    throw new Error("Reopen must not Review or Run");
  });
  await act(async()=>{session.restore(fixture.review.workspace_id,[fixture.run.reference as import("../generated/bpic19-prepared-runs").PreparedReference]);});
  await screen.findByRole("table",{name:/Declared prepared attributes for/});
  expect(screen.getByRole("heading",{name:"Retained/stale supplied native result · Finance"})).toBeTruthy();
  expect(session.savedPreparedAssessments()).toEqual([fixture.run.reference]);
  expect(fetcher.mock.calls.map(call=>call[0])).toEqual(["/api/investigations/bpic19-prepared/read","/api/investigations/bpic19-prepared/export"]);
  const blobs:(Blob|MediaSource)[]=[];
  vi.stubGlobal("URL",class extends URL{static createObjectURL(blob:Blob|MediaSource){blobs.push(blob);return "blob:prepared-export";}static revokeObjectURL(){}});
  const click=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
  try{await user.click(screen.getByRole("button",{name:"Export prepared Finance json"}));await waitFor(()=>expect(blobs).toHaveLength(1));expect(formats).toEqual(["json","json"]);}finally{click.mockRestore();}
});

it("does not let an old actual Review callback publish across a workspace-context revision",async()=>{
  const {session,fetcher,user}=setup();
  let release!:(response:Response)=>void;let oldRequest:Record<string,unknown>|undefined;
  fetcher.mockImplementationOnce(async(_url,options)=>{oldRequest=JSON.parse(String(options.body));return new Promise<Response>(resolve=>{release=resolve;});});
  async function open(){fireEvent.change(screen.getByRole("textbox",{name:"Declared measurement JSON"}),{target:{value:JSON.stringify({rows:fixture.review.input.rows})}});await user.click(screen.getByRole("button",{name:"Open declared JSON draft"}));await user.click(screen.getByRole("button",{name:"Review declared measurements"}));}
  await open();expect(oldRequest).toBeTruthy();
  await act(async()=>{session.basis({workspace_id:fixture.review.workspace_id,source_context_id:"declared-prepared",revision:2},true);});
  await open();await screen.findByText("Authoritative review received. Choose a view and request Run.");
  await act(async()=>{release(new Response(JSON.stringify({...fixture.review,request_id:oldRequest!.request_id,query_revision:oldRequest!.query_revision}),{headers:{"Content-Type":"application/json"}}));});
  expect(screen.getByRole("button",{name:"Run Finance assessment"}).hasAttribute("disabled")).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(session.getState().context?.revision).toBe(2);
});

it("keeps the native result basis fixed while the analyst chooses another assessment item's 29 cells",async()=>{
  const {session,fetcher,user}=setup();
  fetcher.mockImplementation(async(url,options)=>{
    const request=JSON.parse(String(options.body));
    if(url.endsWith("/read"))return new Response(JSON.stringify({...fixture.run,message_type:"bpic19_prepared_read_answer",request_id:request.request_id,query_revision:request.query_revision}),{headers:{"Content-Type":"application/json"}});
    return new Response(JSON.stringify({format:"bpic19.declared-prepared-export.v1",reference:fixture.run.reference,input:fixture.review.input,output:{}}),{headers:{"Content-Type":"application/json","Content-Disposition":'attachment; filename="prepared-finance.json"'}});
  });
  await act(async()=>{session.restore(fixture.review.workspace_id,[fixture.run.reference as import("../generated/bpic19-prepared-runs").PreparedReference]);});
  await screen.findByRole("table",{name:/Declared prepared attributes for/});
  await user.selectOptions(screen.getByRole("combobox",{name:"Native assessment item"}),fixture.run.cases[1].assessment_item_id);
  const native=screen.getByRole("table",{name:"Supplied native contributions · "+fixture.run.reference.run_id});
  expect(within(native).getAllByRole("row")).toHaveLength(30);
  expect(within(native).getAllByRole("rowheader").every(row=>row.textContent?.startsWith(fixture.run.cases[1].assessment_item_id))).toBe(true);
  expect(session.savedPreparedAssessments()).toEqual([fixture.run.reference]);
  expect(fetcher.mock.calls.some(call=>call[0].endsWith("/run"))).toBe(false);
});

it.each(["run","export"] as const)("drops an old actual %s callback after a newer declaration edit",async operation=>{
  const {session,fetcher,user}=setup();let release!:(response:Response)=>void;let held:Record<string,unknown>|undefined;
  fetcher.mockImplementation(async(url,options)=>{
    const request=JSON.parse(String(options.body));
    const payload=url.endsWith("/run")?fixture.run:fixture.review;
    return new Response(JSON.stringify({...payload,request_id:request.request_id,query_revision:request.query_revision,workspace_id:request.workspace_id}),{headers:{"Content-Type":"application/json"}});
  });
  fireEvent.change(screen.getByRole("textbox",{name:"Declared measurement JSON"}),{target:{value:JSON.stringify({rows:fixture.review.input.rows})}});
  await user.click(screen.getByRole("button",{name:"Open declared JSON draft"}));await user.click(screen.getByRole("button",{name:"Review declared measurements"}));
  await screen.findByText("Authoritative review received. Choose a view and request Run.");
  if(operation==="export"){
    await user.click(screen.getByRole("button",{name:"Run Finance assessment"}));await screen.findByText("Native result received for the exact reviewed input.");
    await user.click(screen.getByRole("button",{name:"Request retain of "+fixture.run.reference.run_id}));
  }
  fetcher.mockImplementationOnce(async(_url,options)=>{held=JSON.parse(String(options.body));return new Promise<Response>(resolve=>{release=resolve;});});
  const blobs:(Blob|MediaSource)[]=[];vi.stubGlobal("URL",class extends URL{static createObjectURL(blob:Blob|MediaSource){blobs.push(blob);return "blob:late-prepared";}static revokeObjectURL(){}});
  await user.click(screen.getByRole("button",{name:operation==="run"?"Run Finance assessment":"Export prepared Finance json"}));
  expect(held).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox",{name:"Declared measurement JSON"}),{target:{value:'{"rows":[]}'}});
  await act(async()=>{release(new Response(JSON.stringify(operation==="run"?{...fixture.run,request_id:held!.request_id,query_revision:held!.query_revision}:
    {format:"bpic19.declared-prepared-export.v1",input:fixture.review.input,output:{},reference:fixture.run.reference}),{headers:{"Content-Type":"application/json","Content-Disposition":'attachment; filename="prepared-finance.json"'}}));});
  expect(blobs).toHaveLength(0);expect(session.savedPreparedAssessments()).toBeUndefined();expect(session.readyForSave()).toBe(false);
  expect(screen.queryByRole("heading",{name:/Current supplied native result/})).toBeNull();
});

it("refuses duplicate declared JSON fields before selecting a value or making a service request",async()=>{
  const {fetcher,user}=setup();
  const text=JSON.stringify({rows:fixture.review.input.rows}).replace('"flow":"DF1"','"flow":"DF1","flow":"DF2"');
  fireEvent.change(screen.getByRole("textbox",{name:"Declared measurement JSON"}),{target:{value:text}});
  await user.click(screen.getByRole("button",{name:"Open declared JSON draft"}));
  expect(screen.getByRole("alert").textContent).toContain("Duplicate declared JSON field: flow");expect(fetcher).not.toHaveBeenCalled();
});
