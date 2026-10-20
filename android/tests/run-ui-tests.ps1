param([Parameter(Mandatory = $true)][string]$JavaHome)
$ErrorActionPreference = 'Stop'
$uiRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$uiOutput = Join-Path $uiRoot 'scratch/android-ui-test-classes'
New-Item -ItemType Directory -Force -Path $uiOutput | Out-Null
& (Join-Path $JavaHome 'bin/javac.exe') --release 8 -encoding UTF-8 -d $uiOutput `
    (Join-Path $uiRoot 'android/app/src/main/java/br/com/acervo/app/MobileUiModel.java') `
    (Join-Path $PSScriptRoot 'MobileUiModelTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar os testes da interface mobile.' }
& (Join-Path $JavaHome 'bin/java.exe') -classpath $uiOutput br.com.acervo.app.MobileUiModelTest
if ($LASTEXITCODE -ne 0) { throw 'Falha nos testes da interface mobile.' }
