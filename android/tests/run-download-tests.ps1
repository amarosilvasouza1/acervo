param([Parameter(Mandatory = $true)][string]$JavaHome)
$ErrorActionPreference = 'Stop'
$downloadRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$downloadOutput = Join-Path ([IO.Path]::GetTempPath()) ('acervo-range-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $downloadOutput | Out-Null
& (Join-Path $JavaHome 'bin/javac.exe') --release 11 -encoding UTF-8 -d $downloadOutput (Join-Path $downloadRoot 'android/app/src/main/java/br/com/acervo/app/RangeDownload.java') (Join-Path $PSScriptRoot 'RangeDownloadTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o teste de download.' }
& (Join-Path $JavaHome 'bin/java.exe') -cp $downloadOutput br.com.acervo.app.RangeDownloadTest
if ($LASTEXITCODE -ne 0) { throw 'Falha no teste real de download por partes.' }
