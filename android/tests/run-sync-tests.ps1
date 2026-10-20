param(
    [Parameter(Mandatory = $true)][string]$JavaHome,
    [Parameter(Mandatory = $true)][string]$SdkRoot,
    [Parameter(Mandatory = $true)][string]$ExtractorJar
)
$ErrorActionPreference = 'Stop'
$syncRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$syncOutput = Join-Path ([IO.Path]::GetTempPath()) ('acervo-sync-metadata-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $syncOutput | Out-Null
$syncClasspath = (Join-Path $SdkRoot 'platforms/android-35/android.jar') + [IO.Path]::PathSeparator + $ExtractorJar
$syncSources = @('DeviceSync', 'MobileLibrary', 'RangeDownload', 'MobileArtworkCache', 'MobileSource', 'SecureTransport', 'PhoneIdentity', 'PinnedTls', 'PairingLink') |
    ForEach-Object { Join-Path $syncRoot ('android/app/src/main/java/br/com/acervo/app/' + $_ + '.java') }
& (Join-Path $JavaHome 'bin/javac.exe') --release 11 -encoding UTF-8 -classpath $syncClasspath -d $syncOutput @syncSources (Join-Path $PSScriptRoot 'DeviceSyncMetadataTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar a sincronizacao e seus testes.' }
& (Join-Path $JavaHome 'bin/java.exe') -classpath ($syncOutput + [IO.Path]::PathSeparator + $syncClasspath) br.com.acervo.app.DeviceSyncMetadataTest
if ($LASTEXITCODE -ne 0) { throw 'Falha no contrato dos metadados sincronizados.' }
