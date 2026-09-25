begin;
create table if not exists public.customer_submission_requests (
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  request_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  kind text not null check (kind in ('booking','registration')),
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (clinic_id, request_id)
);
alter table public.customer_submission_requests enable row level security;
revoke all on public.customer_submission_requests from public, anon, authenticated;
grant all on public.customer_submission_requests to service_role;

create or replace function public.submit_booking_once(p_clinic_id uuid, p_patient_id uuid, p_request_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
 previous public.customer_submission_requests%rowtype;
 fingerprint text := encode(digest(p_payload::text,'sha256'),'hex');
 ids uuid[] := '{}'; item record; result jsonb; identifier uuid; queue integer;
 service uuid := nullif(p_payload->>'service_id','')::uuid;
 doctor uuid := nullif(p_payload->>'doctor_id','')::uuid;
 start_time timestamptz := nullif(p_payload->>'start_at','')::timestamptz;
 template uuid := nullif(p_payload->>'template_id','')::uuid;
 target_date date := nullif(p_payload->>'date','')::date;
 visit text := coalesce(p_payload->>'visit_type','return');
 self_pay boolean := coalesce((p_payload->>'is_self_pay')::boolean,false);
 membership text := nullif(p_payload->>'membership_code','');
 answers jsonb := coalesce(p_payload->'booking_answers','{}');
 snapshot jsonb := coalesce(p_payload->'booking_form_snapshot','[]');
 addons uuid[] := array(select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'addon_ids','[]')));
 occurrences integer := coalesce((p_payload->>'recurrence_count')::integer,1);
 mode text;
begin
 if p_request_id is null or jsonb_typeof(p_payload)<>'object' then raise exception 'invalid submission'; end if;
 perform pg_advisory_xact_lock(hashtextextended('submission:'||p_clinic_id::text||':'||p_request_id::text,0));
 select * into previous from public.customer_submission_requests where clinic_id=p_clinic_id and request_id=p_request_id;
 if found then
   if previous.patient_id<>p_patient_id or previous.kind<>'booking' or previous.payload_hash<>fingerprint then raise exception 'submission content mismatch'; end if;
   return previous.result || jsonb_build_object('replayed',true);
 end if;
 if not exists(select 1 from public.patients where id=p_patient_id and clinic_id=p_clinic_id and active) then raise exception 'invalid submission customer'; end if;
 select booking_mode into mode from public.clinic_settings where clinic_id=p_clinic_id;
 if occurrences>1 then
   for item in select * from public.book_recurring_appointments(p_clinic_id,service,doctor,p_patient_id,start_time,template,target_date,visit,self_pay,membership,answers,snapshot,addons,occurrences,1)
   loop ids:=array_append(ids,item.appointment_id); if identifier is null then identifier:=item.appointment_id; queue:=item.queue_number; end if; end loop;
 elsif mode='time' then
   if service is not null then identifier:=public.book_time_slot_with_options(p_clinic_id,service,doctor,p_patient_id,start_time,visit,self_pay,membership,answers,snapshot,addons);
   elsif membership is not null then identifier:=public.book_time_slot_with_membership_for_service(p_clinic_id,doctor,p_patient_id,start_time,visit,self_pay,membership,null);
   else identifier:=public.book_time_slot_for_service(p_clinic_id,doctor,p_patient_id,start_time,visit,self_pay,null); end if;
   ids:=array[identifier];
 elsif mode='number' then
   if service is not null then select * into item from public.book_number_with_options(p_clinic_id,service,doctor,p_patient_id,template,target_date,visit,self_pay,membership,answers,snapshot,addons);
   elsif membership is not null then select * into item from public.book_number_with_membership(p_clinic_id,doctor,p_patient_id,template,target_date,visit,self_pay,membership);
   else select * into item from public.book_number(p_clinic_id,doctor,p_patient_id,template,target_date,visit,self_pay); end if;
   identifier:=item.appointment_id; queue:=item.queue_number; ids:=array[identifier];
 else raise exception 'invalid booking mode'; end if;
 if identifier is null or cardinality(ids)<>occurrences then raise exception 'incomplete submission'; end if;
 update public.appointments set source='online' where clinic_id=p_clinic_id and id=any(ids);
 if service is not null then update public.appointments set service_id=service,booking_answers=answers,booking_form_snapshot=snapshot where clinic_id=p_clinic_id and id=any(ids); end if;
 if nullif(p_payload->>'email','') is not null then update public.patients set email=p_payload->>'email' where id=p_patient_id and clinic_id=p_clinic_id; end if;
 result:=jsonb_build_object('appointment_ids',ids,'queue_number',queue);
 insert into public.customer_submission_requests(clinic_id,request_id,patient_id,kind,payload_hash,result) values(p_clinic_id,p_request_id,p_patient_id,'booking',fingerprint,result);
 return result||jsonb_build_object('replayed',false);
end $$;

create or replace function public.submit_registration_once(p_clinic_id uuid,p_patient_id uuid,p_request_id uuid,p_payload jsonb,p_token text,p_token_encrypted text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare previous public.customer_submission_requests%rowtype; fingerprint text:=encode(digest(p_payload::text,'sha256'),'hex'); item record; result jsonb;
begin
 if p_request_id is null or jsonb_typeof(p_payload)<>'object' or nullif(p_token,'') is null or nullif(p_token_encrypted,'') is null then raise exception 'invalid submission'; end if;
 perform pg_advisory_xact_lock(hashtextextended('submission:'||p_clinic_id::text||':'||p_request_id::text,0));
 select * into previous from public.customer_submission_requests where clinic_id=p_clinic_id and request_id=p_request_id;
 if found then
   if previous.patient_id<>p_patient_id or previous.kind<>'registration' or previous.payload_hash<>fingerprint then raise exception 'submission content mismatch'; end if;
   select * into item from public.registrations where clinic_id=p_clinic_id and patient_id=p_patient_id and id=(previous.result->>'registration_id')::uuid;
   if not found then raise exception 'submission result unavailable'; end if;
   return previous.result||jsonb_build_object('registration_status',item.status,'payment_status',item.payment_status,'replayed',true);
 end if;
 select * into item from public.register_for_event_with_terms(p_clinic_id,(p_payload->>'event_id')::uuid,(p_payload->>'session_id')::uuid,nullif(p_payload->>'ticket_type_id','')::uuid,p_payload->>'name',p_payload->>'phone',p_payload->>'email',p_payload->>'line_user_id',coalesce((p_payload->>'marketing_opt_in')::boolean,false),coalesce(p_payload->'answers','{}'),p_payload->>'access_token',p_payload->>'discount_code',p_payload->>'membership_code',nullif(p_payload->>'form_id','')::uuid,(p_payload->>'form_version')::integer,(p_payload->>'terms_version')::integer,case when p_payload->>'terms_version' is not null then now() else null end,p_patient_id);
 -- The generated credential and its envelope commit with the registration and request receipt.
 update public.registrations set checkin_token_hash=encode(digest(p_token,'sha256'),'hex'),checkin_token_encrypted=p_token_encrypted where clinic_id=p_clinic_id and id=item.registration_id;
 result:=jsonb_build_object('registration_id',item.registration_id,'registration_no',item.registration_no,'registration_status',item.registration_status,'payment_status',item.payment_status,'amount',item.amount,'checkin_token_encrypted',p_token_encrypted);
 insert into public.customer_submission_requests(clinic_id,request_id,patient_id,kind,payload_hash,result) values(p_clinic_id,p_request_id,p_patient_id,'registration',fingerprint,result);
 return result||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.submit_booking_once(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.submit_registration_once(uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.submit_booking_once(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.submit_registration_once(uuid,uuid,uuid,jsonb,text,text) to service_role;
commit;
