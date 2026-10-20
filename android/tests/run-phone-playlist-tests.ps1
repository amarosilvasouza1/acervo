param([string]$JavaHome)
$ErrorActionPreference = 'Stop'
if (-not $JavaHome) {
    $chainPath = Join-Path $env:LOCALAPPDATA 'Temp/acervo-android-toolchain/toolchain.json'
    if (Test-Path -LiteralPath $chainPath) { $JavaHome = (Get-Content -LiteralPath $chainPath -Raw | ConvertFrom-Json).javaHome }
    else { $JavaHome = $env:JAVA_HOME }
}
$testClasses = Join-Path ([System.IO.Path]::GetTempPath()) ('acervo-phone-playlist-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testClasses | Out-Null
$sourceDir = Join-Path $PSScriptRoot '../app/src/main/java/br/com/acervo/app'
& (Join-Path $JavaHome 'bin/javac.exe') -encoding UTF-8 -d $testClasses (Join-Path $sourceDir 'PhonePlaylistCsv.java') (Join-Path $sourceDir 'PhonePlaylistMatch.java') (Join-Path $PSScriptRoot 'PhonePlaylistTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar testes da playlist do celular.' }
& (Join-Path $JavaHome 'bin/java.exe') -cp $testClasses br.com.acervo.app.PhonePlaylistTest
if ($LASTEXITCODE -ne 0) { throw 'Falha nos testes da playlist do celular.' }
