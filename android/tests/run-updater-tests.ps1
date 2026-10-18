[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$JavaHome,
    [Parameter(Mandatory = $true)][string]$SdkRoot
)

$ErrorActionPreference = 'Stop'
$updaterRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$updaterOutput = Join-Path ([System.IO.Path]::GetTempPath()) ('acervo-updater-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $updaterOutput | Out-Null
$updaterAndroidJar = Join-Path $SdkRoot 'platforms/android-35/android.jar'
$updaterJavaRoot = Join-Path $updaterRoot 'android/app/src/main/java/br/com/acervo/app'
& (Join-Path $JavaHome 'bin/javac.exe') --release 8 -encoding UTF-8 -classpath $updaterAndroidJar -d $updaterOutput `
    (Join-Path $updaterJavaRoot 'PairingLink.java') `
    (Join-Path $updaterJavaRoot 'ApkProvider.java') `
    (Join-Path $updaterJavaRoot 'UpdateSource.java') `
    (Join-Path $updaterJavaRoot 'AppUpdater.java') `
    (Join-Path $PSScriptRoot 'AppUpdaterPolicyTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar testes do atualizador.' }
& (Join-Path $JavaHome 'bin/java.exe') -classpath ($updaterOutput + [System.IO.Path]::PathSeparator + $updaterAndroidJar) br.com.acervo.app.AppUpdaterPolicyTest
if ($LASTEXITCODE -ne 0) { throw 'Falha nos testes do atualizador.' }
