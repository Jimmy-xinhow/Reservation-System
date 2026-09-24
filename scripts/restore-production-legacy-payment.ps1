param(
  [Parameter(Mandatory=$true)][string]$BackupPath,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
if ($env:RAILWAY_ENVIRONMENT_NAME -ne 'production' -or
    $env:NEXT_PUBLIC_SUPABASE_URL -ne 'https://cmoacgcbxllfpwhiidsx.supabase.co') {
  throw 'Production payment restore guard failed'
}
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\.local-backups'))
$path = [System.IO.Path]::GetFullPath($BackupPath)
if ([System.IO.Path]::GetDirectoryName($path) -ne $root -or
    [System.IO.Path]::GetExtension($path) -ne '.dpapi' -or
    -not (Test-Path -LiteralPath $path)) {
  throw 'Payment restore snapshot path is invalid'
}
$manifestPath = "$path.meta.json"
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Payment restore manifest missing' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.backupPath -ne $path -or $manifest.version -ne 1 -or
    $manifest.itemCount -ne 2 -or $manifest.protection -ne 'Windows DPAPI CurrentUser') {
  throw 'Payment restore manifest mismatch'
}

Add-Type -AssemblyName System.Security
$ciphertext = [System.IO.File]::ReadAllBytes($path)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $ciphertext, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $plainHash = ([System.BitConverter]::ToString($sha.ComputeHash($plain))).Replace('-', '').ToLowerInvariant()
  $cipherHash = ([System.BitConverter]::ToString($sha.ComputeHash($ciphertext))).Replace('-', '').ToLowerInvariant()
} finally { $sha.Dispose() }
if ($plainHash -ne $manifest.plaintextSha256 -or
    $cipherHash -ne $manifest.encryptedSha256) { throw 'Payment restore checksum mismatch' }
$snapshot = [System.Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
if ($snapshot.version -ne 1 -or $snapshot.productionHost -ne 'cmoacgcbxllfpwhiidsx.supabase.co' -or
    @($snapshot.items).Count -ne 2 -or
    [datetimeoffset]::new([datetime]$snapshot.expiresAt) -le [datetimeoffset]::UtcNow) {
  throw 'Payment restore snapshot content or retention period invalid'
}
foreach ($item in @($snapshot.items)) {
  if ($item.order.id -notmatch '^[0-9a-f-]{36}$' -or
      $item.transaction.id -notmatch '^[0-9a-f-]{36}$' -or
      $item.webhook.id -notmatch '^[0-9a-f-]{36}$' -or
      $item.order.id -ne $item.transaction.payment_order_id -or
      $item.order.clinic_id -ne $item.transaction.clinic_id -or
      $item.order.clinic_id -ne $item.webhook.clinic_id -or
      $item.order.provider -ne $item.webhook.provider -or
      $item.transaction.event_key -ne $item.webhook.event_key -or
      $item.order.status -ne 'paid' -or $item.transaction.status -ne 'accepted') {
    throw 'Payment restore snapshot linkage invalid'
  }
}

$native = @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct G303Credential {
 public uint Flags; public uint Type;
 [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
 [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
 public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
 public uint CredentialBlobSize; public IntPtr CredentialBlob;
 public uint Persist; public uint AttributeCount; public IntPtr Attributes;
 [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
 [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
}
public static class G303CredentialApi {
 [DllImport("Advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern bool CredRead(string target, uint type, uint flags, out IntPtr ptr);
 [DllImport("Advapi32.dll", EntryPoint="CredFree", SetLastError=true)]
 public static extern void CredFree(IntPtr ptr);
}
'@
Add-Type -TypeDefinition $native
$credentialPtr = [IntPtr]::Zero
if (-not [G303CredentialApi]::CredRead('Supabase CLI:supabase', 1, 0, [ref]$credentialPtr)) {
  throw 'Supabase CLI management credential unavailable'
}
try {
  $credential = [System.Runtime.InteropServices.Marshal]::PtrToStructure[G303Credential]($credentialPtr)
  $tokenBytes = New-Object byte[] $credential.CredentialBlobSize
  [System.Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $tokenBytes, 0, $tokenBytes.Length)
  $token = [System.Text.Encoding]::UTF8.GetString($tokenBytes).Trim([char]0)
  if (-not $token.StartsWith('sbp_')) {
    $token = [System.Text.Encoding]::Unicode.GetString($tokenBytes).Trim([char]0)
  }
  if (-not $token.StartsWith('sbp_')) { throw 'Supabase CLI credential format invalid' }

  function Invoke-G303Query([string]$sql, [bool]$readOnly) {
    $body = @{query=$sql; read_only=$readOnly} | ConvertTo-Json -Depth 4 -Compress
    try {
      return Invoke-RestMethod -Method Post -Uri 'https://api.supabase.com/v1/projects/cmoacgcbxllfpwhiidsx/database/query' `
        -Headers @{Authorization="Bearer $token"} -ContentType 'application/json' -Body $body
    } catch {
      $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'unknown' }
      throw "Supabase management query failed ($status)"
    }
  }

  # The old callback values stay in memory and travel only to Supabase over HTTPS.
  # They are never written to a SQL file, command line or report.
  $itemsJson = ConvertTo-Json -InputObject @($snapshot.items) -Depth 60 -Compress
  $itemsLiteral = $itemsJson.Replace("'", "''")
  $projection = @"
select
  (entry->'order'->>'id')::uuid as order_id,
  (entry->'order'->>'clinic_id')::uuid as clinic_id,
  entry->'order'->>'provider' as provider,
  entry->'order'->>'merchant_order_no' as merchant_order_no,
  (entry->'order'->>'amount')::integer as amount,
  entry->'order'->'provider_payload' as old_order_payload,
  (entry->'transaction'->>'id')::uuid as transaction_id,
  entry->'transaction'->>'event_key' as event_key,
  entry->'transaction'->>'provider_transaction_no' as provider_transaction_no,
  entry->'transaction'->'payload' as old_transaction_payload,
  (entry->'webhook'->>'id')::uuid as webhook_id,
  entry->'webhook'->'payload' as old_webhook_payload
from jsonb_array_elements('$itemsLiteral'::jsonb) as entry
"@
  if (-not $Execute) {
    $query = @"
with b as ($projection)
select count(*)::integer as matching_originals
from b
join public.payment_orders o on o.id=b.order_id and o.clinic_id=b.clinic_id
join public.payment_transactions t on t.id=b.transaction_id and t.payment_order_id=o.id
join public.payment_webhook_events w on w.id=b.webhook_id and w.event_key=b.event_key
where o.status='paid' and t.status='accepted'
  and o.provider_payload=b.old_order_payload
  and t.payload=b.old_transaction_payload and w.payload=b.old_webhook_payload
  and exists (select 1 from public.payment_status_events e
    where e.clinic_id=b.clinic_id and e.payment_order_id=b.order_id and e.to_status='paid')
"@
    $rows = @(Invoke-G303Query $query $true)
    if ($rows.Count -ne 1 -or $rows[0].matching_originals -ne 2) {
      throw 'Current production original payloads do not match encrypted snapshot'
    }
    [pscustomobject]@{mode='verify-originals';matchingOriginals=2;databaseWrites=0;
      rawValuesPrinted=$false} | ConvertTo-Json -Compress
    exit 0
  }

  $query = @"
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.payment_orders, public.payment_transactions,
  public.payment_webhook_events, public.payment_status_events
  in share row exclusive mode;
create temporary table g303_restore on commit drop as $projection;
do `$$
declare n integer;
begin
  if (select count(*) from g303_restore) <> 2
    or (select count(distinct order_id) from g303_restore) <> 2
    or (select count(distinct transaction_id) from g303_restore) <> 2
    or (select count(distinct webhook_id) from g303_restore) <> 2 then
    raise exception 'G3-03 recovery snapshot population mismatch';
  end if;
  select count(*) into n
  from g303_restore b
  join public.payment_orders o on o.id=b.order_id and o.clinic_id=b.clinic_id
  join public.payment_transactions t on t.id=b.transaction_id and t.payment_order_id=o.id
  join public.payment_webhook_events w on w.id=b.webhook_id and w.event_key=b.event_key
  where o.provider=b.provider and o.merchant_order_no=b.merchant_order_no
    and o.amount=b.amount and o.status='paid' and t.status='accepted'
    and t.event_key=b.event_key and t.provider_transaction_no is not distinct from b.provider_transaction_no
    and t.clinic_id=b.clinic_id and w.clinic_id=b.clinic_id and w.provider=b.provider
    and o.provider_payload - 'last_event' = b.old_order_payload - 'last_event'
    and t.payload->'receipt_version'='1'::jsonb
    and w.payload=t.payload and o.provider_payload->'last_event'=t.payload
    and exists (select 1 from public.payment_status_events e
      where e.clinic_id=b.clinic_id and e.payment_order_id=b.order_id and e.to_status='paid');
  if n <> 2 then raise exception 'G3-03 current receipt state differs from recovery precondition'; end if;
  update public.payment_transactions t set payload=b.old_transaction_payload
    from g303_restore b where t.id=b.transaction_id;
  get diagnostics n=row_count;
  if n<>2 then raise exception 'G3-03 transaction recovery count mismatch'; end if;
  update public.payment_webhook_events w set payload=b.old_webhook_payload
    from g303_restore b where w.id=b.webhook_id;
  get diagnostics n=row_count;
  if n<>2 then raise exception 'G3-03 webhook recovery count mismatch'; end if;
  update public.payment_orders o set provider_payload=b.old_order_payload
    from g303_restore b where o.id=b.order_id;
  get diagnostics n=row_count;
  if n<>2 then raise exception 'G3-03 order recovery count mismatch'; end if;
  select count(*) into n from g303_restore b
  join public.payment_orders o on o.id=b.order_id
  join public.payment_transactions t on t.id=b.transaction_id
  join public.payment_webhook_events w on w.id=b.webhook_id
  where o.provider_payload=b.old_order_payload and t.payload=b.old_transaction_payload
    and w.payload=b.old_webhook_payload and o.status='paid' and t.status='accepted';
  if n<>2 then raise exception 'G3-03 recovery verification mismatch'; end if;
end `$$;
commit;
"@
  [void](Invoke-G303Query $query $false)
  $verify = @"
with b as ($projection)
select count(*)::integer as restored from b
join public.payment_orders o on o.id=b.order_id
join public.payment_transactions t on t.id=b.transaction_id
join public.payment_webhook_events w on w.id=b.webhook_id
where o.provider_payload=b.old_order_payload and t.payload=b.old_transaction_payload
  and w.payload=b.old_webhook_payload and o.status='paid' and t.status='accepted'
"@
  $rows = @(Invoke-G303Query $verify $true)
  if ($rows.Count -ne 1 -or $rows[0].restored -ne 2) { throw 'Post-recovery verification failed' }
  [pscustomobject]@{mode='exact-id-atomic-restore';restoredTransactions=2;
    restoredPayloadCopies=6;rawValuesPrinted=$false} | ConvertTo-Json -Compress
} finally { [G303CredentialApi]::CredFree($credentialPtr) }
