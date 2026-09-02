begin;

create table if not exists public.api_rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_api_rate_limit_buckets_expires_at
  on public.api_rate_limit_buckets (expires_at);

alter table public.api_rate_limit_buckets enable row level security;
revoke all on table public.api_rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on table public.api_rate_limit_buckets to service_role;

create or replace function public.consume_api_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_expires_at timestamptz;
begin
  if length(p_bucket_key) <> 64 or p_limit < 1 or p_limit > 10000 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit arguments';
  end if;

  insert into public.api_rate_limit_buckets as bucket (
    bucket_key,
    window_started_at,
    request_count,
    expires_at,
    updated_at
  )
  values (
    p_bucket_key,
    v_now,
    1,
    v_now + make_interval(secs => p_window_seconds),
    v_now
  )
  on conflict (bucket_key) do update
  set window_started_at = case when bucket.expires_at <= v_now then v_now else bucket.window_started_at end,
      request_count = case when bucket.expires_at <= v_now then 1 else bucket.request_count + 1 end,
      expires_at = case when bucket.expires_at <= v_now then v_now + make_interval(secs => p_window_seconds) else bucket.expires_at end,
      updated_at = v_now
  returning bucket.request_count, bucket.expires_at into v_count, v_expires_at;

  if random() < 0.01 then
    delete from public.api_rate_limit_buckets
     where bucket_key in (
       select expired.bucket_key
         from public.api_rate_limit_buckets expired
        where expired.expires_at < v_now - interval '1 day'
        order by expired.expires_at
        limit 100
     );
  end if;

  return query
  select v_count <= p_limit,
         case when v_count <= p_limit then 0 else greatest(1, ceil(extract(epoch from (v_expires_at - v_now)))::integer) end;
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;

commit;
