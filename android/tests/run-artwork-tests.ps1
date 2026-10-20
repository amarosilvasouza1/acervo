param([Parameter(Mandatory = $true)][string]$JavaHome)
$ErrorActionPreference = 'Stop'
$artworkRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$artworkOutput = Join-Path ([IO.Path]::GetTempPath()) ('acervo-artwork-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $artworkOutput | Out-Null
& (Join-Path $JavaHome 'bin/javac.exe') --release 11 -encoding UTF-8 -d $artworkOutput `
    (Join-Path $artworkRoot 'android/app/src/main/java/br/com/acervo/app/MobileArtworkCache.java') `
    (Join-Path $artworkRoot 'android/app/src/main/java/br/com/acervo/app/BlackBars.java') `
    (Join-Path $PSScriptRoot 'MobileArtworkCacheTest.java') `
    (Join-Path $PSScriptRoot 'BlackBarsTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar os testes das capas offline.' }
& (Join-Path $JavaHome 'bin/java.exe') -classpath $artworkOutput br.com.acervo.app.MobileArtworkCacheTest
if ($LASTEXITCODE -ne 0) { throw 'Falha nos testes das capas offline.' }
& (Join-Path $JavaHome 'bin/java.exe') -classpath $artworkOutput br.com.acervo.app.BlackBarsTest
if ($LASTEXITCODE -ne 0) { throw 'Falha na detecção de bordas pretas.' }
