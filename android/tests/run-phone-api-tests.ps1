param([Parameter(Mandatory = $true)][string]$JavaHome,[Parameter(Mandatory = $true)][string]$NanoJsonJar)
$ErrorActionPreference = 'Stop'
$testClasses = Join-Path ([System.IO.Path]::GetTempPath()) ('acervo-phone-api-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testClasses | Out-Null
$sourceDir = Join-Path $PSScriptRoot '../app/src/main/java/br/com/acervo/app'
$apiSources = @('PhoneApi.java','PhonePlaylistParser.java','PhonePlaylistCsv.java','PhonePlaylistMatch.java','MobileLibrary.java','RangeDownload.java','MobileArtworkCache.java') | ForEach-Object { Join-Path $sourceDir $_ }
$fixtureSources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'phone-api-fixtures') -Filter '*.java' -Recurse | ForEach-Object { $_.FullName })
& (Join-Path $JavaHome 'bin/javac.exe') --release 11 -encoding UTF-8 -cp $NanoJsonJar -d $testClasses @apiSources @fixtureSources (Join-Path $PSScriptRoot 'PhoneApiTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar testes da API do celular.' }
& (Join-Path $JavaHome 'bin/java.exe') -cp ($testClasses + [IO.Path]::PathSeparator + $NanoJsonJar) br.com.acervo.app.PhoneApiTest
if ($LASTEXITCODE -ne 0) { throw 'Falha nos testes da API do celular.' }
