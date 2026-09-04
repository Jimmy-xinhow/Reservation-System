import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { verifyBrowserBookingToken } from "@/lib/browser-booking";
import { fail, ok } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LearningRequest { browser_token?: string; action?: "complete"|"uncomplete"|"submit_assessment"; unit_id?: string; answer_index?: number; submission_text?: string; }
interface RegistrationRow { id:string;event_id:string;status:string;payment_status:string;created_at:string;events:{title:string}|{title:string}[]|null; }
interface UnitRow { id:string;event_id:string;title:string;summary:string|null;unit_type:"video"|"link"|"download"|"text"|"quiz"|"assignment";content_url:string|null;body:string|null;access_rule:"registered"|"paid"|"attended";release_mode:"immediate"|"days_after_registration"|"after_previous";release_days:number;sort_order:number; }
interface AssessmentRow { id:string;unit_id:string;kind:"quiz"|"assignment";prompt:string;options:unknown;correct_option?:number|null;passing_score:number; }
interface SubmissionRow { unit_id:string;status:"submitted"|"passed"|"revision";score:number|null;feedback:string|null;submission_text:string|null;submitted_at:string; }

function eventTitle(value:RegistrationRow["events"]):string{return Array.isArray(value)?value[0]?.title??"未命名課程":value?.title??"未命名課程";}
function baseAccess(unit:UnitRow,registration:RegistrationRow):boolean{const registered=["pending","confirmed","attended"].includes(registration.status);if(!registered)return false;if(unit.access_rule==="attended")return registration.status==="attended";if(unit.access_rule==="paid")return ["confirmed","attended"].includes(registration.status)&&["paid","not_required"].includes(registration.payment_status);return true;}
function releaseState(unit:UnitRow,registration:RegistrationRow,eventUnits:UnitRow[],completed:Set<string>):{available:boolean;message:string|null}{
  if(unit.release_mode==="days_after_registration"){const unlockAt=new Date(new Date(registration.created_at).getTime()+unit.release_days*86_400_000);if(Date.now()<unlockAt.getTime())return{available:false,message:`將於 ${unlockAt.toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"})} 開放`};}
  if(unit.release_mode==="after_previous"){const index=eventUnits.findIndex(item=>item.id===unit.id);const previous=index>0?eventUnits[index-1]:null;if(previous&&!completed.has(previous.id))return{available:false,message:`完成「${previous.title}」後開放`};}
  return{available:true,message:null};
}
function optionList(value:unknown):string[]{return Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):[];}

export async function POST(request:NextRequest){
  const rate=await checkRateLimit(request,"customer:learning",30);if(!rate.allowed)return fail("操作太頻繁，請稍後再試",429);
  try{
    const body=await request.json().catch(()=>null) as LearningRequest|null;const service=createServiceClient();const clinicId=await resolvePublicClinicId(request,service);if(!clinicId)return fail("找不到品牌入口",404);
    const identity=body?.browser_token?.trim()?verifyBrowserBookingToken(body.browser_token.trim()):null;if(!identity)return fail("顧客身分已過期，請重新驗證",401);if(identity.clinicId!==clinicId)return fail("品牌入口不相符",403);
    const {data:patient,error:patientError}=await service.from("patients").select("id,name").eq("id",identity.patientId).eq("clinic_id",clinicId).eq("active",true).maybeSingle();if(patientError)throw new Error(patientError.message);if(!patient)return fail("找不到顧客資料",404);
    const {data:registrationData,error:registrationError}=await service.from("registrations").select("id,event_id,status,payment_status,created_at,events(title)").eq("clinic_id",clinicId).eq("patient_id",patient.id).in("status",["pending","confirmed","attended"]);if(registrationError)throw new Error(registrationError.message);
    const registrations=(registrationData??[]) as unknown as RegistrationRow[];const eventIds=[...new Set(registrations.map(item=>item.event_id))];if(eventIds.length===0)return ok({patient,courses:[]});
    const {data:unitsData,error:unitsError}=await service.from("course_units").select("id,event_id,title,summary,unit_type,content_url,body,access_rule,release_mode,release_days,sort_order").eq("clinic_id",clinicId).eq("active",true).in("event_id",eventIds).order("sort_order").order("created_at");if(unitsError)throw new Error(unitsError.message);
    const units=(unitsData??[]) as UnitRow[];
    const loadProgress=async()=>{const {data,error}=units.length>0?await service.from("course_unit_progress").select("unit_id,registration_id,completed_at").eq("clinic_id",clinicId).eq("patient_id",patient.id).in("unit_id",units.map(item=>item.id)):{data:[],error:null};if(error)throw new Error(error.message);return data??[];};
    let progress=await loadProgress();let completed=new Set(progress.map(row=>String(row.unit_id)));
    if(body?.action){
      const unit=units.find(item=>item.id===body.unit_id);if(!unit)return fail("找不到可使用的教材單元",404);const eventUnits=units.filter(item=>item.event_id===unit.event_id);const registration=registrations.find(item=>item.event_id===unit.event_id&&baseAccess(unit,item));if(!registration)return fail("尚未符合這個教材的開放條件",403);if(!releaseState(unit,registration,eventUnits,completed).available)return fail("這個單元尚未開放",403);
      if(body.action==="complete"||body.action==="uncomplete"){
        if(["quiz","assignment"].includes(unit.unit_type))return fail("測驗或作業必須依指定方式完成",400);
        if(body.action==="complete"){const {error}=await service.from("course_unit_progress").upsert({clinic_id:clinicId,event_id:unit.event_id,unit_id:unit.id,registration_id:registration.id,patient_id:patient.id,completed_at:new Date().toISOString()},{onConflict:"registration_id,unit_id"});if(error)throw new Error(error.message);}
        else{const {error}=await service.from("course_unit_progress").delete().eq("clinic_id",clinicId).eq("patient_id",patient.id).eq("registration_id",registration.id).eq("unit_id",unit.id);if(error)throw new Error(error.message);}
      }else{
        const {data:assessmentData,error:assessmentError}=await service.from("course_assessments").select("id,unit_id,kind,prompt,options,correct_option,passing_score").eq("clinic_id",clinicId).eq("unit_id",unit.id).eq("active",true).maybeSingle();if(assessmentError)throw new Error(assessmentError.message);const assessment=assessmentData as AssessmentRow|null;if(!assessment)return fail("找不到測驗或作業設定",404);
        const {data:existing}=await service.from("course_assessment_submissions").select("status").eq("clinic_id",clinicId).eq("registration_id",registration.id).eq("unit_id",unit.id).maybeSingle();
        if(existing?.status!=="passed"){
          if(assessment.kind==="quiz"){const options=optionList(assessment.options);const answer=Number(body.answer_index);if(!Number.isInteger(answer)||answer<0||answer>=options.length)return fail("請選擇一個答案",400);const passed=answer===assessment.correct_option;const {error}=await service.from("course_assessment_submissions").upsert({clinic_id:clinicId,assessment_id:assessment.id,unit_id:unit.id,registration_id:registration.id,patient_id:patient.id,answer:{option:answer},submission_text:null,score:passed?100:0,status:passed?"passed":"revision",feedback:passed?"答對了":"答案不正確，請再試一次",reviewed_at:new Date().toISOString(),submitted_at:new Date().toISOString()},{onConflict:"registration_id,unit_id"});if(error)throw new Error(error.message);if(passed){const {error:progressError}=await service.from("course_unit_progress").upsert({clinic_id:clinicId,event_id:unit.event_id,unit_id:unit.id,registration_id:registration.id,patient_id:patient.id,completed_at:new Date().toISOString()},{onConflict:"registration_id,unit_id"});if(progressError)throw new Error(progressError.message);}}
          else{const submissionText=String(body.submission_text??"").trim();if(submissionText.length<5)return fail("作業內容至少需要 5 個字",400);const {error}=await service.from("course_assessment_submissions").upsert({clinic_id:clinicId,assessment_id:assessment.id,unit_id:unit.id,registration_id:registration.id,patient_id:patient.id,answer:{},submission_text:submissionText.slice(0,20000),score:null,status:"submitted",feedback:null,reviewed_by:null,reviewed_at:null,submitted_at:new Date().toISOString()},{onConflict:"registration_id,unit_id"});if(error)throw new Error(error.message);}
        }
      }
      const {error:certificateError}=await service.rpc("issue_course_certificate_if_complete",{p_clinic_id:clinicId,p_registration_id:registration.id});if(certificateError)throw new Error(certificateError.message);
      progress=await loadProgress();completed=new Set(progress.map(row=>String(row.unit_id)));
    }
    const baseUnits=units.filter(unit=>registrations.some(registration=>registration.event_id===unit.event_id&&baseAccess(unit,registration)));
    const releasedIds=baseUnits.filter(unit=>{const registration=registrations.find(item=>item.event_id===unit.event_id&&baseAccess(unit,item));return registration&&releaseState(unit,registration,units.filter(item=>item.event_id===unit.event_id),completed).available;}).map(item=>item.id);
    const [{data:assessmentData,error:assessmentError},{data:submissionData,error:submissionError},{data:certificateData,error:certificateError}]=await Promise.all([
      releasedIds.length?service.from("course_assessments").select("id,unit_id,kind,prompt,options,passing_score").eq("clinic_id",clinicId).eq("active",true).in("unit_id",releasedIds):Promise.resolve({data:[],error:null}),
      baseUnits.length?service.from("course_assessment_submissions").select("unit_id,status,score,feedback,submission_text,submitted_at").eq("clinic_id",clinicId).eq("patient_id",patient.id).in("unit_id",baseUnits.map(item=>item.id)):Promise.resolve({data:[],error:null}),
      service.from("course_certificates").select("event_id,certificate_no,issued_at").eq("clinic_id",clinicId).eq("patient_id",patient.id).in("event_id",eventIds),
    ]);if(assessmentError||submissionError||certificateError)throw new Error(assessmentError?.message??submissionError?.message??certificateError?.message??"學習資料載入失敗");
    const assessments=new Map(((assessmentData??[]) as AssessmentRow[]).map(item=>[item.unit_id,{id:item.id,kind:item.kind,prompt:item.prompt,options:optionList(item.options),passing_score:item.passing_score}]));const submissions=new Map(((submissionData??[]) as SubmissionRow[]).map(item=>[item.unit_id,item]));const progressMap=new Map(progress.map(row=>[String(row.unit_id),String(row.completed_at)]));const certificates=new Map((certificateData??[]).map(row=>[String(row.event_id),{certificate_no:String(row.certificate_no),issued_at:String(row.issued_at)}]));
    const courses=eventIds.map(eventId=>{const registration=registrations.find(item=>item.event_id===eventId);const eventUnits=units.filter(item=>item.event_id===eventId);const courseUnits=baseUnits.filter(item=>item.event_id===eventId).map(unit=>{const state=registration?releaseState(unit,registration,eventUnits,completed):{available:false,message:"尚未開放"};return{...unit,content_url:state.available?unit.content_url:null,body:state.available?unit.body:null,release_available:state.available,unlock_message:state.message,completed_at:progressMap.get(unit.id)??null,assessment:state.available?assessments.get(unit.id)??null:null,submission:submissions.get(unit.id)??null};});return registration&&courseUnits.length?{event_id:eventId,title:eventTitle(registration.events),certificate:certificates.get(eventId)??null,units:courseUnits}:null;}).filter((item):item is NonNullable<typeof item>=>item!==null);
    return ok({patient,courses});
  }catch(error){return fail(error instanceof Error?error.message:"學習內容載入失敗",500);}
}
