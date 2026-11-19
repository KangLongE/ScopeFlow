# Run from the private installation directory under the Windows account that protected the inputs.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Add-Type -AssemblyName System.Security
function Read-ProtectedBytes($name) {
    $cipher = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $name))
    return ,([Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, 'CurrentUser'))
}
$key = Read-ProtectedBytes 'archive-key.dpapi'
$connection = Read-ProtectedBytes 'source.dpapi'
try {
    $env:BACKUP_ENCRYPTION_KEY = if ($key.Length -eq 32) { [Convert]::ToBase64String($key) } else { [Text.Encoding]::UTF8.GetString($key) }
    $env:DATABASE_URL = [Text.Encoding]::UTF8.GetString($connection)
    $env:DATABASE_ENVIRONMENT = $env:SCOPEFLOW_ENV = 'production'
    $env:PG_DUMP_PATH = Join-Path $PSScriptRoot 'bin/pg_dump.exe'
    $env:PG_RESTORE_PATH = Join-Path $PSScriptRoot 'bin/pg_restore.exe'
    $node = Join-Path $env:ProgramFiles 'nodejs/node.exe'
    $created = & $node ./backup.mjs create
    if ($LASTEXITCODE) { throw 'Encrypted backup failed' }
    $archive = ($created | ConvertFrom-Json).backup
    if ((Split-Path -Parent $archive) -ne (Join-Path $PSScriptRoot 'backups')) { throw 'Unexpected backup location' }
    $verified = & $node ./backup.mjs verify $archive
    if ($LASTEXITCODE -or !($verified | ConvertFrom-Json).archiveVerified) { throw 'Archive verification failed' }
    [PSCustomObject]@{ verifiedAt = [DateTime]::UtcNow.ToString('o'); archive = (Split-Path -Leaf $archive) } |
        ConvertTo-Json | Set-Content -LiteralPath ./last-success.json -Encoding UTF8
} finally {
    [Array]::Clear($key, 0, $key.Length)
    [Array]::Clear($connection, 0, $connection.Length)
    Remove-Item Env:BACKUP_ENCRYPTION_KEY, Env:DATABASE_URL -ErrorAction SilentlyContinue
}
