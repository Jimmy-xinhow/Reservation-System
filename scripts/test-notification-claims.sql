begin;
set local request.jwt.claim.role='service_role';
do $$
declare c uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); s uuid:=gen_random_uuid();
 r uuid:=gen_random_uuid(); nextreg uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); offer uuid:=gen_random_uuid(); held uuid:=gen_random_uuid();
 mp uuid:=gen_random_uuid(); po uuid:=gen_random_uuid(); coupon uuid:=gen_random_uuid(); result jsonb; blocked boolean; n integer;
begin
 assert not has_function_privilege('anon','public.process_registration_cron_scope(uuid,uuid[],uuid[],uuid[],uuid[])','execute');
 insert into clinics(id,name,slug)values(c,'G306 scope','g306-'||c),(other,'G306 foreign','g306-'||other);
 insert into patients(id,clinic_id,name,phone)values(p,c,'synthetic','0900000000');
 insert into doctors(id,clinic_id,name)values(d,c,'synthetic');
 insert into events(id,clinic_id,title,slug)values(e,c,'synthetic','scope');
 insert into event_sessions(id,clinic_id,event_id,name,start_at,end_at,capacity)values(s,c,e,'synthetic',now()+interval'2 days',now()+interval'2 days 1 hour',1);
 insert into registrations(id,clinic_id,event_id,session_id,patient_id,registration_no,name,phone,checkin_token_hash,status,payment_status,expires_at)values
 (r,c,e,s,p,'one','synthetic','0900000000',r::text,'pending','pending',now()-interval'1 hour'),(nextreg,c,e,s,p,'two','synthetic','0900000000',nextreg::text,'waitlisted','not_required',null);
 insert into waitlist_entries(clinic_id,registration_id,session_id,position)values(c,nextreg,s,1);
 insert into appointments(id,clinic_id,patient_id,doctor_id,start_at,end_at,status,visit_type,deposit_status,deposit_expires_at)values
 (a,c,p,d,now()+interval'1 day',now()+interval'1 day 30 minutes','booked','return','pending',now()-interval'1 hour'),
 (held,c,p,d,now()+interval'3 days',now()+interval'3 days 30 minutes','booked','return','none',null);
 insert into appointment_waitlist_entries(id,clinic_id,patient_id,doctor_id,booking_mode,requested_date,requested_start_at,target_key,position,status,appointment_id,offer_expires_at)values
 (w,c,p,d,'time',(now()+interval'1 day')at time zone'Asia/Taipei',now()+interval'1 day','synthetic',1,'waiting',null,null),
 (offer,c,p,d,'time',(now()+interval'3 days')at time zone'Asia/Taipei',now()+interval'3 days','synthetic-offer',1,'offered',held,now()-interval'1 hour');
 insert into membership_plans(id,clinic_id,name,credits_total,price)values(mp,c,'synthetic',1,100);
 insert into payment_orders(id,clinic_id,membership_plan_id,patient_id,provider,merchant_order_no,amount,expires_at)values(po,c,mp,p,'ecpay',po::text,100,now()-interval'1 hour');
 insert into discount_codes(id,clinic_id,code,kind,value,used_count)values(coupon,c,'SCOPE','fixed',1,1);
 insert into discount_redemptions(clinic_id,discount_code_id,registration_id,original_amount,discount_amount,final_amount)values(c,coupon,r,100,1,99);
 result:=process_registration_cron_scope(other,array[r],array[a],array[po],array[offer]);assert (result->>'expired')::int=0 and result->'registration_ids'='[]'::jsonb;
 blocked:=false;begin perform process_registration_cron_scope(c,array[r],array[a],array[po],array[offer]);exception when others then blocked:=sqlerrm='cron scope excludes affected waitlist';end;assert blocked,'registration closure not rejected';
 assert(select status='pending'from registrations where id=r);assert(select status='pending'from payment_orders where id=po);
 blocked:=false;begin perform process_registration_cron_scope(c,array[r,nextreg],array[a],array[po],array[offer]);exception when others then blocked:=sqlerrm='cron scope excludes affected waitlist';end;assert blocked,'appointment closure not rejected';
 assert(select status='pending'from registrations where id=r),'registration expiry not rolled back';assert(select status='waitlisted'from registrations where id=nextreg),'promotion not rolled back';assert(select used_count=1 from discount_codes where id=coupon),'benefits not rolled back';
 result:=process_registration_cron_scope(c,array[r,nextreg],array[a],array[po],array[offer,w]);
 assert (result->>'expired')::int=1;assert (result->>'expired_appointments')::int=1;assert (result->>'expired_membership_payments')::int=1;assert (result->>'expired_waitlist_offers')::int=1;assert (result->>'released_benefits')::int=1;
 assert(select status='confirmed'from registrations where id=nextreg);assert(select status='cancelled'from appointments where id=a);assert(select status='cancelled'from appointments where id=held);assert(select used_count=0 from discount_codes where id=coupon);
 assert coalesce(current_setting('app.registration_cron_scope',true),'')='','scope leaked';
 result:=process_registration_cron_scope(c,array[r,nextreg],array[a],array[po],array[offer,w]);assert (result->>'expired')::int=0 and (result->>'released_benefits')::int=0 and (result->>'expired_waitlist_offers')::int=0;
 select count(*)into n from claim_appointment_waitlist_notifications_for_scope(other,array[w]);assert n=0;
 select count(*)into n from claim_appointment_waitlist_notifications_for_scope(c,array[offer]);assert n>0;
 select count(*)into n from claim_appointment_waitlist_notifications_for_scope(c,array[offer]);assert n=0;
 assert not exists(select 1 from appointment_waitlist_notification_logs where waitlist_id=w and status='claimed');

 -- Expired claimed records must remain claimed in both SQL entry points.
 update appointment_waitlist_notification_logs set updated_at=now()-interval '1 day' where waitlist_id=offer;
 select count(*) into n from claim_appointment_waitlist_notifications_for_scope(c,array[offer]); assert n=0;
 perform * from claim_appointment_waitlist_notifications(200);
 assert not exists(select 1 from appointment_waitlist_notification_logs where waitlist_id=offer and attempt_count<>1);

 -- Insert an actually old claim (UPDATE would invoke touch_updated_at).
 po:=gen_random_uuid();
 insert into appointment_waitlist_entries(id,clinic_id,patient_id,doctor_id,booking_mode,requested_date,requested_start_at,target_key,position,status)
 values(po,c,p,d,'time',current_date+90,now()+interval '90 days','unknown-'||po,1,'waiting');
 insert into appointment_waitlist_notification_logs(clinic_id,waitlist_id,patient_id,kind,channel,status,attempt_count,updated_at)
 values(c,po,p,'expired','line','claimed',1,'2000-01-01T00:00:00Z');
 perform * from claim_appointment_waitlist_notifications_for_scope(c,array[po]);
 perform * from claim_appointment_waitlist_notifications(200);
 assert(select status='claimed' and attempt_count=1 and updated_at='2000-01-01T00:00:00Z' from appointment_waitlist_notification_logs where waitlist_id=po and kind='expired');
 -- Reminder claims: first claim, recent/old uncertainty, proven pre-send failure, sent.
 po:=claim_reminder(a,'line'); assert po is not null;
 blocked:=false;begin perform claim_reminder(a,'line');exception when others then blocked:=sqlerrm='notification_delivery_unconfirmed';end;assert blocked;
 update reminder_logs set sent_at=now()-interval '1 day' where id=po;
 blocked:=false;begin perform claim_reminder(a,'line');exception when others then blocked:=sqlerrm='notification_delivery_unconfirmed';end;assert blocked;
 update reminder_logs set result='failed' where id=po; assert claim_reminder(a,'line')=po;
 update reminder_logs set result='sent' where id=po; assert claim_reminder(a,'line') is null;
 assert not has_function_privilege('anon','public.claim_reminder(uuid,text)','execute');
 assert not has_function_privilege('authenticated','public.claim_appointment_waitlist_notifications(integer)','execute');
 update clinics set active=false where id=c;result:=process_registration_cron_scope(c,array[r],array[a],array[po],array[offer]);assert result->'registration_ids'='[]'::jsonb;
 blocked:=false;begin perform process_registration_cron_scope(c,'{}','{}','{}','{}');exception when others then blocked:=true;end;assert blocked;
 perform set_config('request.jwt.claim.role','authenticated',true);blocked:=false;begin perform process_registration_cron_scope(c,array[r],'{}','{}','{}');exception when others then blocked:=true;end;assert blocked;
 raise notice 'Scoped composite SQL: five stages, closure rollback, promotion, isolation, rerun, queue claims and role checks passed';
end $$;
rollback;
