import { describe, expect, it } from "vitest";
import type { CsvInspectionAnswer, InspectCsvRequest, RoleSuggestion } from "../generated/imports";
import { inspectionAnswer } from "../test/imports";
import { formatLabels, proposedRoles, timeFormats } from "./interpretation";

describe("native BPIC19 timestamp choices",()=>{
  it("offers explicit day-month-year seconds/fractions and leaves its unzoned clock for review",()=>{
    expect(timeFormats).toContain("dmy_dash_second");
    expect(formatLabels.dmy_dash_second).toContain("31-12-2026 17:45:10.123");
    const request:InspectCsvRequest={schema_version:1,message_type:"inspect_csv_request",request_id:"native-inspect",query_revision:1,workspace_id:"workspace.v1:0123456789abcdef",source_id:"source.v1:sha256:"+"5".repeat(64),hints:{}};
    const names=["eventID ","case Spend area text","case Company","case Document Type","case Sub spend area text","case Purchasing Document","case Purch. Doc. Category name","case Vendor","case Item Type","case Item Category","case Spend classification text","case Source","case Name","case GR-Based Inv. Verif.","case Item","case concept:name","case Goods Receipt","event User","event org:resource","event concept:name","event Cumulative net worth (EUR)","event time:timestamp"];
    const suggestions:RoleSuggestion[]=names.map((_,column_index)=>({column_index,roles:["context","case_id","activity",...(column_index===21?["timestamp" as const]:[])],nonempty_count:7,distinct_nonempty_count:column_index===15?4:column_index===19?5:column_index===21?7:2,timestamp_matches:timeFormats.map(format=>({format,parsed_count:column_index===21&&format==="dmy_dash_second"?7:0}))}));
    const cells=names.map(()=>"value");cells[15]="D1_1";cells[19]="Create Purchase Order Item";cells[21]="26-01-1948 23:59:00.000";
    const inspected:CsvInspectionAnswer={...inspectionAnswer(request),columns:names.map((name,index)=>({name,index})),record_count:7,role_suggestions:suggestions,sample_rows:[{source_position:0,cells}]};
    const proposal=proposedRoles(inspected);
    expect(proposal.caseColumn).toBe(15);expect(proposal.timestampColumn).toBe(21);
    // Existing aliases deliberately do not guess "event concept:name" as an activity;
    // the native importer still admits the analyst's explicit activity-column19 mapping.
    expect(proposal.activityColumn).toBeNull();
    expect(proposal.timeFormat).toBe("dmy_dash_second");expect(proposal.zone).toBeNull();
  });
});
