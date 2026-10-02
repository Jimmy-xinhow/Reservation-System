param(
  [Parameter(Mandatory=$true)][ValidateSet('Backup','Verify','Purge')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$Path,
  [string]$ExpectedSha256,
  [string]$ExpiresAt
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$resolvedRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\.local-backups'))
$resolvedPath = [System.IO.Path]::GetFullPath($Path)
if ([System.IO.Path]::GetDirectoryName($resolvedPath) -ne $resolvedRoot -or
    [System.IO.Path]::GetExtension($resolvedPath) -ne '.dpapi') {
  throw 'Snapshot path is outside the private backup directory'
}

function Get-Sha256([byte[]]$bytes) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Set-OwnerOnlyAcl([string]$target) {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $isDirectory = [System.IO.Directory]::Exists($target)
  $section = [System.Security.AccessControl.AccessControlSections]::Access
  $acl = if ($isDirectory) {
    [System.IO.Directory]::GetAccessControl($target, $section)
  } else {
    [System.IO.File]::GetAccessControl($target, $section)
  }
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleAll($rule) }
  $allow = New-Object System.Security.AccessControl.FileSystemAccessRule($identity.User, 'FullControl', 'Allow')
  [void]$acl.AddAccessRule($allow)
  if ($isDirectory) { [System.IO.Directory]::SetAccessControl($target, $acl) }
  else { [System.IO.File]::SetAccessControl($target, $acl) }
}

if ($Mode -eq 'Backup') {
  if (Test-Path -LiteralPath $resolvedPath) { throw 'Snapshot already exists' }
  $stdinReader = New-Object System.IO.StreamReader(
    [Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding($false)))
  try { $plaintext = $stdinReader.ReadToEnd() }
  finally { $stdinReader.Dispose() }
  if ([string]::IsNullOrWhiteSpace($plaintext)) { throw 'Empty snapshot' }
  $decoded = $plaintext | ConvertFrom-Json
  if ($decoded.version -ne 1 -or @($decoded.items).Count -ne 2 -or
      [datetimeoffset]::Parse($decoded.expiresAt) -le [datetimeoffset]::UtcNow) {
    throw 'Invalid snapshot structure or expiry'
  }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($plaintext)
  $sha256 = Get-Sha256 $bytes
  $ciphertext = [System.Security.Cryptography.ProtectedData]::Protect(
    $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [void][System.IO.Directory]::CreateDirectory($resolvedRoot)
  Set-OwnerOnlyAcl $resolvedRoot
  try {
    $file = New-Object System.IO.FileStream($resolvedPath,
      [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write,
      [System.IO.FileShare]::None)
    try { $file.Write($ciphertext, 0, $ciphertext.Length) }
    finally { $file.Dispose() }
    Set-OwnerOnlyAcl $resolvedPath
    $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(
      [System.IO.File]::ReadAllBytes($resolvedPath), $null,
      [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    if ((Get-Sha256 $decrypted) -ne $sha256) { throw 'Snapshot restore check failed' }
  } catch {
    if (Test-Path -LiteralPath $resolvedPath) { Remove-Item -LiteralPath $resolvedPath -Force }
    throw
  }
  [pscustomobject]@{
    restoredInMemory = $true
    plaintextSha256 = $sha256
    encryptedSha256 = (Get-Sha256 $ciphertext)
    encryptedBytes = $ciphertext.Length
    expiresAt = $decoded.expiresAt
    protection = 'Windows DPAPI CurrentUser'
  } | ConvertTo-Json -Compress
  exit 0
}

if (-not (Test-Path -LiteralPath $resolvedPath)) { throw 'Snapshot not found' }
$ciphertext = [System.IO.File]::ReadAllBytes($resolvedPath)
$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $ciphertext, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
$actualSha256 = Get-Sha256 $decrypted
$decoded = [System.Text.Encoding]::UTF8.GetString($decrypted) | ConvertFrom-Json
if ($Mode -eq 'Verify') {
  if ($ExpectedSha256 -notmatch '^[a-f0-9]{64}$' -or $actualSha256 -ne $ExpectedSha256 -or
      $decoded.version -ne 1 -or @($decoded.items).Count -ne 2) {
    throw 'Snapshot verification failed'
  }
  [pscustomobject]@{ restoredInMemory = $true; itemCount = @($decoded.items).Count;
    plaintextSha256Matched = $true; encryptedSha256 = (Get-Sha256 $ciphertext) } |
    ConvertTo-Json -Compress
  exit 0
}

if ([datetimeoffset]::Parse($decoded.expiresAt) -gt [datetimeoffset]::UtcNow) {
  throw 'Snapshot is not yet expired'
}
Remove-Item -LiteralPath $resolvedPath -Force
$manifestPath = "$resolvedPath.meta.json"
if (Test-Path -LiteralPath $manifestPath) { Remove-Item -LiteralPath $manifestPath -Force }
[pscustomobject]@{ expiredSnapshotDeleted = $true; manifestDeleted = !(Test-Path -LiteralPath $manifestPath) } |
  ConvertTo-Json -Compress
