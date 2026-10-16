import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Bpic19LiteratureClaims, type PurchasingLiteratureClaim } from "./Bpic19LiteratureClaims";
const run="score-run-current";
const claim:PurchasingLiteratureClaim={claim_id:"literal-source-1",report_id:"R04",source_locator:"Merged PDF82",claim:"Reported complete190283 and training189584",claim_level:"reported_not_rerun",compared_run_id:run};

it("starts empty, pauses a draft, adds an explicitly cited fixed-level claim and links only a supplied run",async()=>{
  const onChange=vi.fn(),onValidityChange=vi.fn();const view=render(<Bpic19LiteratureClaims claims={[]} runIds={[run]} onChange={onChange} onValidityChange={onValidityChange}/>);const user=userEvent.setup();
  expect(screen.queryByRole("table")).toBeNull();await waitFor(()=>expect(onValidityChange).toHaveBeenLastCalledWith(true));
  await user.selectOptions(screen.getByRole("combobox",{name:"Supplied literature source"}),"R04");
  expect(onValidityChange).toHaveBeenLastCalledWith(false);expect(screen.getByRole("button",{name:"Add reported literature note"}).hasAttribute("disabled")).toBe(true);
  await user.type(screen.getByRole("textbox",{name:"Source page, cell or exact locator"}),"Merged PDF82");
  await user.type(screen.getByRole("textbox",{name:"Reported statement"}),"Reported complete190283 and training189584");
  await user.selectOptions(screen.getByRole("combobox",{name:"Compared saved native run (optional)"}),run);
  await user.click(screen.getByRole("button",{name:"Add reported literature note"}));
  expect(onChange).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({report_id:"R04",source_locator:"Merged PDF82",claim:"Reported complete190283 and training189584",claim_level:"reported_not_rerun",compared_run_id:run})]);
  const added:PurchasingLiteratureClaim[]=onChange.mock.calls[0][0];expect(added[0].claim_id).not.toBe("");
  view.rerender(<Bpic19LiteratureClaims claims={added} runIds={[run]} onChange={onChange} onValidityChange={onValidityChange}/>);
  expect(screen.getByRole("table").textContent).toContain("reported_not_rerun");await waitFor(()=>expect(onValidityChange).toHaveBeenLastCalledWith(true));
});
it("cancels unfinished source text without inventing a note or discarding a linked claim",async()=>{
  const onChange=vi.fn(),onValidityChange=vi.fn();render(<Bpic19LiteratureClaims claims={[claim]} runIds={[run]} onChange={onChange} onValidityChange={onValidityChange}/>);const user=userEvent.setup();
  await user.type(screen.getByRole("textbox",{name:"Reported statement"}),"A draft finding");expect(onValidityChange).toHaveBeenLastCalledWith(false);
  await user.click(screen.getByRole("button",{name:"Cancel unadded literature note"}));expect(onChange).not.toHaveBeenCalled();
  await waitFor(()=>expect(onValidityChange).toHaveBeenLastCalledWith(true));expect(screen.getByRole("table").textContent).toContain(claim.claim);
});
it("retains invalid run references visibly and refuses duplicate IDs or over100 notes until explicit removal",async()=>{
  const onChange=vi.fn(),onValidityChange=vi.fn();const view=render(<Bpic19LiteratureClaims claims={[claim]} runIds={[]} onChange={onChange} onValidityChange={onValidityChange}/>);const user=userEvent.setup();
  expect(screen.getByRole("alert").textContent).toContain("No invalid note is silently dropped");expect(onValidityChange).toHaveBeenLastCalledWith(false);
  await user.click(screen.getByRole("button",{name:"Remove literature note 1"}));expect(onChange).toHaveBeenLastCalledWith([]);
  view.rerender(<Bpic19LiteratureClaims claims={[claim,{...claim}]} runIds={[run]} onChange={onChange} onValidityChange={onValidityChange}/>);expect(onValidityChange).toHaveBeenLastCalledWith(false);
  const full=Array.from({length:100},(_,i)=>({...claim,claim_id:`claim-${i}`}));view.rerender(<Bpic19LiteratureClaims claims={full} runIds={[run]} onChange={onChange} onValidityChange={onValidityChange}/>);
  fireEvent.change(screen.getByRole("combobox",{name:"Supplied literature source"}),{target:{value:"wise-paper"}});fireEvent.change(screen.getByRole("textbox",{name:"Source page, cell or exact locator"}),{target:{value:"WISE PDF26"}});fireEvent.change(screen.getByRole("textbox",{name:"Reported statement"}),{target:{value:"Reported source statement"}});
  expect(screen.getByRole("button",{name:"Add reported literature note"}).hasAttribute("disabled")).toBe(true);
});
it("keeps an unfinished linked-run draft paused when available runs change, with an explicit missing-reference choice",async()=>{
  const onChange=vi.fn(),onValidityChange=vi.fn();const view=render(<Bpic19LiteratureClaims claims={[]} runIds={[run]} onChange={onChange} onValidityChange={onValidityChange}/>);const user=userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox",{name:"Compared saved native run (optional)"}),run);
  view.rerender(<Bpic19LiteratureClaims claims={[]} runIds={[]} onChange={onChange} onValidityChange={onValidityChange}/>);
  expect(screen.getByRole("option",{name:/Unavailable run reference/})).toBeTruthy();expect(onValidityChange).toHaveBeenLastCalledWith(false);expect(onChange).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button",{name:"Cancel unadded literature note"}));await waitFor(()=>expect(onValidityChange).toHaveBeenLastCalledWith(true));
});
