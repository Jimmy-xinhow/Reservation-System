-- Counts only. Do not select raw error text or customer data.
with import_summary as (
  select count(*)::integer as rows_total,
         count(*) filter (where jsonb_typeof(error_summary) = 'array' and jsonb_array_length(error_summary) > 0)::integer as error_values,
         coalesce(sum(case when jsonb_typeof(error_summary) = 'array' then jsonb_array_length(error_summary) else 0 end), 0)::integer as detail_entries,
         count(*) filter (where exists (
           select 1 from jsonb_array_elements(case when jsonb_typeof(error_summary) = 'array' then error_summary else '[]'::jsonb end) item
           where item ->> 'reason' not in (
             'row must be an object', 'invalid name', 'invalid phone',
             'phone patient limit reached', 'service already exists',
             'patient not found', 'membership plan not found', 'credits must be positive',
             'import row failed', 'import job failed'
           )
         ))::integer as unknown_reason_rows
  from public.data_import_jobs
)
select 'crm_delivery_logs' as source,
       count(*)::integer as rows_total,
       count(*) filter (where error is not null)::integer as error_values,
       count(*) filter (where error is not null and error not in (
         '顧客已停用', '顧客未同意行銷', '顧客沒有 LINE 身分',
         '顧客或品牌尚未完成 Email 設定',
         'delivery_error:configuration', 'delivery_error:database',
         'delivery_error:connection', 'delivery_error:internal'
       ))::integer as unknown_reason_rows,
       count(*) filter (where error is not null)::integer as detail_entries
from public.crm_delivery_logs
union all
select 'scheduled_followups',
       count(*)::integer,
       count(*) filter (where last_error is not null)::integer,
       count(*) filter (where last_error is not null and last_error not in (
         '顧客已停用', '顧客未同意行銷', '顧客沒有 LINE 身分',
         '顧客或品牌尚未完成 Email 設定',
         'delivery_error:configuration', 'delivery_error:database',
         'delivery_error:connection', 'delivery_error:internal'
       ))::integer,
       count(*) filter (where last_error is not null)::integer
from public.scheduled_followups
union all
select 'data_import_jobs', rows_total, error_values, unknown_reason_rows, detail_entries
from import_summary;
