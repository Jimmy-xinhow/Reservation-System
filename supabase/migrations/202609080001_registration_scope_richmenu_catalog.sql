begin;

alter table public.line_richmenu_versions drop constraint if exists line_richmenu_versions_template_key_check;
alter table public.line_richmenu_versions add constraint line_richmenu_versions_template_key_check check (
  template_key in ('booking','events','mixed','clay-atelier','course-paper','event-cobalt','member-oxblood','retail-monochrome','mineral-wellness','family-coral','swiss-editorial','seasonal-burgundy','custom')
);

create or replace function public.create_line_richmenu_version(
  p_clinic_id uuid, p_actor_user_id uuid, p_name text, p_template_key text,
  p_layout text, p_chat_bar_text text, p_slots jsonb
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid; v_version integer;
begin
  if not exists (select 1 from public.clinic_members member where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role in ('owner', 'admin'))
    then raise exception 'brand admin access required'; end if;
  if p_layout not in ('full-3', 'full-6', 'compact-2', 'compact-3') then raise exception 'invalid rich menu layout'; end if;
  if p_template_key not in ('booking','events','mixed','clay-atelier','course-paper','event-cobalt','member-oxblood','retail-monochrome','mineral-wellness','family-coral','swiss-editorial','seasonal-burgundy','custom') then raise exception 'invalid rich menu template'; end if;
  if jsonb_typeof(coalesce(p_slots, '[]'::jsonb)) <> 'array' then raise exception 'rich menu slots must be an array'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 120 then raise exception 'rich menu version name is invalid'; end if;
  if length(btrim(coalesce(p_chat_bar_text, ''))) not between 1 and 14 then raise exception 'rich menu chat bar text is invalid'; end if;
  perform pg_advisory_xact_lock(hashtext('richmenu-version:' || p_clinic_id::text));
  select coalesce(max(version_no), 0) + 1 into v_version from public.line_richmenu_versions where clinic_id = p_clinic_id;
  insert into public.line_richmenu_versions (clinic_id, version_no, name, template_key, layout, chat_bar_text, slots, created_by)
  values (p_clinic_id, v_version, btrim(p_name), p_template_key, p_layout, btrim(p_chat_bar_text), coalesce(p_slots, '[]'::jsonb), p_actor_user_id)
  returning id into v_id;
  insert into public.line_richmenu (clinic_id) values (p_clinic_id) on conflict (clinic_id) do nothing;
  update public.line_richmenu set draft_version_id = v_id, updated_at = now() where clinic_id = p_clinic_id;
  return v_id;
end; $$;
revoke all on function public.create_line_richmenu_version(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_line_richmenu_version(uuid, uuid, text, text, text, text, jsonb) to service_role;

update public.clinic_settings settings set brand_logo_url = case clinic.slug
  when 'demo-beauty' then '/demo-brands/demo-beauty-logo.png'
  when 'demo-course' then '/demo-brands/demo-course-logo.png'
  when 'demo-pilates' then '/demo-brands/demo-pilates-logo.png'
  else settings.brand_logo_url end
from public.clinics clinic
where clinic.id = settings.clinic_id and clinic.slug in ('demo-beauty','demo-course','demo-pilates');

do $$
declare
  demo record;
  version_id uuid;
  v_version_no integer;
begin
  for demo in
    select clinic.id,
      case clinic.slug when 'demo-beauty' then 'ÉLAN 顧客專屬選單' when 'demo-course' then 'OPENROOM 學習入口' else 'FORME 練習與報名入口' end as menu_name,
      case clinic.slug when 'demo-beauty' then 'booking' when 'demo-course' then 'events' else 'mixed' end as template_key,
      case clinic.slug when 'demo-beauty' then
        '[{"label":"立即預約","accessibilityLabel":"開啟線上預約","action":"booking"},{"label":"我的預約","accessibilityLabel":"查詢取消或改期預約","action":"appointments"},{"label":"療程項目","accessibilityLabel":"查看品牌療程與服務","action":"brand"},{"label":"體驗活動","accessibilityLabel":"瀏覽活動與課程報名","action":"events"},{"label":"會員套票","accessibilityLabel":"查看會員套票與堂數","action":"membership"},{"label":"美容顧問","accessibilityLabel":"開啟品牌客服","action":"support"}]'::jsonb
      when 'demo-course' then
        '[{"label":"最新課程","accessibilityLabel":"瀏覽活動與課程報名","action":"events"},{"label":"我的票券","accessibilityLabel":"查看報名與票券","action":"tickets"},{"label":"預約諮詢","accessibilityLabel":"開啟課程諮詢預約","action":"booking"},{"label":"學習權益","accessibilityLabel":"查看會員與學習權益","action":"membership"},{"label":"學習所介紹","accessibilityLabel":"查看品牌資訊","action":"brand"},{"label":"課程客服","accessibilityLabel":"開啟品牌客服","action":"support"}]'::jsonb
      else
        '[{"label":"預約課程","accessibilityLabel":"開啟課程預約","action":"booking"},{"label":"我的預約","accessibilityLabel":"查詢取消或改期預約","action":"appointments"},{"label":"團體課報名","accessibilityLabel":"瀏覽團體課程報名","action":"events"},{"label":"我的課票","accessibilityLabel":"查看報名與票券","action":"tickets"},{"label":"會籍套票","accessibilityLabel":"查看會籍套票與堂數","action":"membership"},{"label":"教室客服","accessibilityLabel":"開啟品牌客服","action":"support"}]'::jsonb end as slots
    from public.clinics clinic where clinic.slug in ('demo-beauty','demo-course','demo-pilates')
  loop
    select version.id into version_id from public.line_richmenu_versions version where version.clinic_id = demo.id and version.name = demo.menu_name order by version.version_no desc limit 1;
    if version_id is null then
      perform pg_advisory_xact_lock(hashtext('richmenu-version:' || demo.id::text));
      select coalesce(max(v.version_no), 0) + 1 into v_version_no from public.line_richmenu_versions v where v.clinic_id = demo.id;
      insert into public.line_richmenu_versions (clinic_id, version_no, name, template_key, layout, chat_bar_text, slots)
      values (demo.id, v_version_no, demo.menu_name, demo.template_key, 'full-6', '品牌選單', demo.slots)
      returning id into version_id;
    end if;
    insert into public.line_richmenu (clinic_id, layout, chat_bar_text, slots, draft_version_id, updated_at)
      values (demo.id, 'full-6', '品牌選單', demo.slots, version_id, now())
      on conflict (clinic_id) do update set layout = excluded.layout, chat_bar_text = excluded.chat_bar_text, slots = excluded.slots, draft_version_id = excluded.draft_version_id, updated_at = now();
  end loop;
end $$;

commit;
