[CmdletBinding()]
param([string]$Repository = 'amarosilvasouza1/acervo')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = '1.2.0'
$apk = Join-Path $root ('releases/acervo-' + $version + '.apk')
$source = Join-Path $root ('releases/acervo-' + $version + '-source.zip')
foreach ($file in @($apk, ($apk + '.sha256'), $source, ($source + '.sha256'))) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Artefato ausente: $file" }
}
$expected = ([System.IO.File]::ReadAllText($apk + '.sha256').Trim() -split '\s+')[0]
if ((Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'O checksum do APK não confere.' }
$notes = Join-Path $root 'releases/android-release-notes.md'
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'Instale o GitHub CLI e entre na conta que administra o repositório.' }
# This script publishes only when explicitly invoked by the repository owner.
& gh release create ('v' + $version) $apk ($apk + '.sha256') $source ($source + '.sha256') --repo $Repository --title ('Acervo Android ' + $version) --notes-file $notes
if ($LASTEXITCODE -ne 0) { throw 'A publicação não foi concluída.' }
