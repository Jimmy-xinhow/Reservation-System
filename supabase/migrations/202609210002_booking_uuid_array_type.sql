begin;
-- Explicit UUID array initializer; booking and receipt behavior is unchanged.
create or replace function public.submit_booking_once(p_clinic_id uuid, p_patient_id uuid, p_request_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
 previous public.customer_submission_requests%rowtype;
 fingerprint text := encode(digest(p_payload::text,'sha256'),'hex');
 ids uuid[] := '{}'::uuid[]; item record; result jsonb; identifier uuid; queue integer;
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
revoke all on function public.submit_booking_once(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.submit_booking_once(uuid,uuid,uuid,jsonb) to service_role;
commit;
