import {sameJson} from "../data/coordinator";
import type {ImportedInvestigationCoordinator} from "../imported/coordinator";
import type {Bpic19PreparedAssessmentReference,SaveInvestigationRequest} from "../generated/saving";
import type {Bpic19PreparedContext} from "./Bpic19PreparedAssessment";

export interface PreparedSessionState {
  context:Bpic19PreparedContext|null;
  available:boolean;
  references:readonly Bpic19PreparedAssessmentReference[];
  dirty:boolean;
  pending:boolean;
  restoration:number;
  reset:number;
}
/** Separate declaration authority. Raw incident identities never identify assessment items. */
export class PreparedAssessmentSession {
  private state:PreparedSessionState={context:null,available:false,references:[],dirty:false,pending:false,restoration:0,reset:0};
  private readonly listeners=new Set<()=>void>();
  private readonly busy=new Set<symbol>();
  private reviewedInput:string|null=null;
  private unsubscribe:(()=>void)|undefined;
  private source="";
  private sourceRevision=0;
  constructor(private readonly investigation?:ImportedInvestigationCoordinator){}
  start():void{
    const investigation=this.investigation;if(!investigation||this.unsubscribe)return;
    const sync=()=>{
      const {population,replacement}=investigation.getState();
      if(population.phase!=="ready"){this.basis(this.state.context,false);return;}
      const {population_id:_population,...reading}=population.answer.identity;
      const next=JSON.stringify([population.answer.workspace_id,reading]);
      if(next!==this.source){this.source=next;this.sourceRevision+=1;}
      this.basis({workspace_id:population.answer.workspace_id,source_context_id:"declared-prepared-measurements",revision:this.sourceRevision},replacement===null);
    };
    this.unsubscribe=investigation.subscribe(sync);sync();
  }
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
  getState=()=>this.state;
  basis(context:Bpic19PreparedContext|null,available:boolean):void{
    const changed=!sameJson(context,this.state.context);
    if(changed){this.busy.clear();this.reviewedInput=null;this.state={...this.state,context,available,references:[],dirty:false,pending:false,reset:this.state.reset+1};this.publish();}
    else if(available!==this.state.available){this.state={...this.state,available};this.publish();}
  }
  changed():void{this.reviewedInput=null;this.state={...this.state,references:[],dirty:true};this.publish();}
  reviewed(inputId:string):void{
    this.reviewedInput=inputId;
    this.state={...this.state,references:this.state.references.filter(reference=>reference.input_id===inputId)};this.publish();
  }
  retain(reference:Bpic19PreparedAssessmentReference):boolean{
    if(!this.state.available||reference.input_id!==this.reviewedInput)return false;
    const references=[...this.state.references.filter(old=>old.view!==reference.view),structuredClone(reference)];
    if(references.length>4||references.some(old=>old.input_id!==reference.input_id))return false;
    this.state={...this.state,references,dirty:false};this.publish();return true;
  }
  discard():void{
    this.busy.clear();this.reviewedInput=null;
    this.state={...this.state,references:[],dirty:false,pending:false,reset:this.state.reset+1};this.publish();
  }
  begin():()=>void{
    const token=Symbol();this.busy.add(token);this.state={...this.state,pending:true};this.publish();
    return ()=>{if(!this.busy.delete(token))return;this.state={...this.state,pending:this.busy.size>0};this.publish();};
  }
  readyForSave():boolean{return this.state.available&&!this.state.dirty&&!this.state.pending;}
  savedPreparedAssessments():SaveInvestigationRequest["bpic19_prepared_assessments"]{
    if(!this.readyForSave())return undefined;
    const [a,b,c,d]=structuredClone(this.state.references);
    return !a?undefined:!b?[a]:!c?[a,b]:!d?[a,b,c]:[a,b,c,d];
  }
  /** Called only after the server reopened and verified this exact investigation. */
  restore(workspaceId:string,references:readonly Bpic19PreparedAssessmentReference[]):void{
    if(workspaceId!==this.state.context?.workspace_id)return;
    const input=references[0]?.input_id;
    if(references.length>4||new Set(references.map(reference=>reference.view)).size!==references.length||references.some(reference=>reference.input_id!==input)){
      this.changed();return;
    }
    this.busy.clear();this.reviewedInput=input??null;
    this.state={...this.state,references:structuredClone([...references]),dirty:false,pending:false,restoration:this.state.restoration+1};this.publish();
  }
  stop():void{this.unsubscribe?.();this.unsubscribe=undefined;this.busy.clear();}
  private publish(){for(const listener of this.listeners)listener();}
}
