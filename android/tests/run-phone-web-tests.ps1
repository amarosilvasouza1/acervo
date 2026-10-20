param([Parameter(Mandatory = $true)][string]$JavaHome)
$ErrorActionPreference = 'Stop'
$phoneWebRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$phoneWebOutput = Join-Path $phoneWebRoot 'scratch/android-phone-web-test-classes'
New-Item -ItemType Directory -Force -Path $phoneWebOutput | Out-Null
& (Join-Path $JavaHome 'bin/javac.exe') --release 8 -encoding UTF-8 -d $phoneWebOutput `
    (Join-Path $phoneWebRoot 'android/app/src/main/java/br/com/acervo/app/PairingLink.java') `
    (Join-Path $phoneWebRoot 'android/app/src/main/java/br/com/acervo/app/PhoneWebPolicy.java') `
    (Join-Path $PSScriptRoot 'PhoneWebPolicyTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar os testes da interface web no APK.' }
& (Join-Path $JavaHome 'bin/java.exe') -classpath $phoneWebOutput br.com.acervo.app.PhoneWebPolicyTest
if ($LASTEXITCODE -ne 0) { throw 'Falha nos testes da interface web no APK.' }
