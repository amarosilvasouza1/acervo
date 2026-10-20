param([Parameter(Mandatory = $true)][string]$JavaHome)
$ErrorActionPreference = 'Stop'
$audioRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$audioOutput = Join-Path ([IO.Path]::GetTempPath()) ('acervo-local-audio-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $audioOutput | Out-Null
& (Join-Path $JavaHome 'bin/javac.exe') --release 11 -encoding UTF-8 -d $audioOutput `
    (Join-Path $audioRoot 'android/app/src/main/java/br/com/acervo/app/LocalAudioResponse.java') `
    (Join-Path $PSScriptRoot 'LocalAudioResponseTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar os testes do áudio local.' }
& (Join-Path $JavaHome 'bin/java.exe') -classpath $audioOutput br.com.acervo.app.LocalAudioResponseTest
if ($LASTEXITCODE -ne 0) { throw 'Falha nos testes do áudio local.' }
