import {request} from "./api.ts";
import type {ApplicationActionInput,ApplicationAnswer,ApplicationFileAnswer,ApplicationPage,PemdaApplicationSummary,PemdaSolarApplication,SolarApplication,SolarApplicationCreateInput,SolarApplicationPatchInput,SolarApplicationSummary,FileKind} from "../shared/applications.ts";
const base=(admin:boolean)=>admin?"/api/pemda/solar-applications":"/api/me/solar-applications";
export const applicationsApi={
 list:(admin=false,query="")=>request<ApplicationPage<PemdaApplicationSummary|SolarApplicationSummary>>(`${base(admin)}?${query}`),
 detail:(id:string,admin=false)=>request<ApplicationAnswer<SolarApplication|PemdaSolarApplication>>(`${base(admin)}/${encodeURIComponent(id)}`),
 create:(body:SolarApplicationCreateInput,key:string)=>request<ApplicationAnswer>(base(false),{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(body)}),
 patch:(id:string,body:SolarApplicationPatchInput)=>request<ApplicationAnswer>(`${base(false)}/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),
 action:(id:string,body:ApplicationActionInput,admin=false)=>request<ApplicationAnswer<SolarApplication|PemdaSolarApplication>>(`${base(admin)}/${encodeURIComponent(id)}/actions`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),
 upload:(file:File,kind:FileKind)=>{const form=new FormData();form.set("kind",kind);form.set("file",file);return request<ApplicationFileAnswer>("/api/me/solar-application-files",{method:"POST",body:form});},
};
