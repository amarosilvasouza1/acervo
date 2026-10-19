[CmdletBinding()]
param(
    [string]$JavaHome,
    [string]$SdkRoot,
    [string]$GradleHome,
    [string]$OutputDirectory,
    [switch]$DependenciesOnly,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $env:LOCALAPPDATA 'Temp/acervo-android-toolchain'
$chain = $null
if (Test-Path -LiteralPath (Join-Path $cache 'toolchain.json')) {
    $chain = Get-Content -LiteralPath (Join-Path $cache 'toolchain.json') -Raw | ConvertFrom-Json
}
if (-not $JavaHome) { $JavaHome = if ($chain) { $chain.javaHome } else { $env:JAVA_HOME } }
if (-not $SdkRoot) { $SdkRoot = if ($chain) { $chain.sdkRoot } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT } }
if (-not $GradleHome) { $GradleHome = Join-Path $cache 'gradle-8.9' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'releases' }
if (-not $JavaHome -or -not $SdkRoot) { throw 'Informe -JavaHome (JDK 21) e -SdkRoot (Android SDK 35).' }
$gradle = Join-Path $GradleHome 'bin/gradle.bat'
if (-not (Test-Path -LiteralPath $gradle)) { throw 'Gradle 8.9 ausente. Consulte android/README.md.' }
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('acervo-gradle-build/' + [Guid]::NewGuid().ToString('N'))
if ($stage -match '[^\x00-\x7F]') { throw 'Use uma pasta TEMP sem acentos para as ferramentas nativas Android.' }
New-Item -ItemType Directory -Path $stage, (Join-Path $stage 'app'), $OutputDirectory -Force | Out-Null
foreach ($file in @('settings.gradle', 'build.gradle', 'gradle.properties')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $stage
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'app/build.gradle') -Destination (Join-Path $stage 'app/build.gradle')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'app/src') -Destination (Join-Path $stage 'app/src') -Recurse
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $stage 'local.properties'), 'sdk.dir=' + $SdkRoot.Replace('\', '/') + "`n", $utf8)
$oldJava = $env:JAVA_HOME
$oldHome = $env:GRADLE_USER_HOME
$oldPath = $env:PATH
$oldPass = $env:ACERVO_BUILD_KEYSTORE_PASSWORD
$oldMavenCache = $env:ACERVO_MAVEN_CACHE
try {
    $env:JAVA_HOME = $JavaHome
    $env:GRADLE_USER_HOME = Join-Path ([System.IO.Path]::GetTempPath()) 'acervo-gradle-cache'
    $env:PATH = (Join-Path $JavaHome 'bin') + ';' + $oldPath
    if (Test-Path -LiteralPath (Join-Path $cache 'maven')) { $env:ACERVO_MAVEN_CACHE = Join-Path $cache 'maven' }
    $gradleArguments = @('-p', $stage, '--no-daemon', '--console=plain')
    if ($Offline) { $gradleArguments += '--offline' }
    if ($DependenciesOnly) {
        & $gradle @gradleArguments :app:writeExtractorClasspath
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao resolver dependências Android.' }
        Write-Host ('CLASSPATH_FILE=' + (Join-Path $stage 'app/build/extractor-classpath.txt'))
        return
    }
    & $gradle @gradleArguments :app:assembleRelease :app:writeExtractorClasspath
    if ($LASTEXITCODE -ne 0) { throw 'Falha na compilação Android.' }
    [xml]$manifest = Get-Content -LiteralPath (Join-Path $stage 'app/src/main/AndroidManifest.xml') -Raw
    $version = $manifest.manifest.GetAttribute('versionName', 'http://schemas.android.com/apk/res/android')
    $tools = Join-Path $SdkRoot 'build-tools/35.0.0'
    $unsigned = Join-Path $stage 'app/build/outputs/apk/release/app-release-unsigned.apk'
    $aligned = Join-Path $stage 'aligned.apk'
    $signed = Join-Path $stage ('acervo-' + $version + '.apk')
    & (Join-Path $tools 'zipalign.exe') -f 4 $unsigned $aligned
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao alinhar APK.' }
    $signing = Join-Path $PSScriptRoot 'signing'
    $keystore = Join-Path $signing 'acervo-release.jks'
    $password = Join-Path $signing 'password.txt'
    if (-not (Test-Path -LiteralPath $keystore) -or -not (Test-Path -LiteralPath $password)) {
        throw 'Chave de assinatura original ausente em android/signing. Restaure-a para gerar uma atualização.'
    }
    $env:ACERVO_BUILD_KEYSTORE_PASSWORD = [System.IO.File]::ReadAllText($password).Trim()
    & (Join-Path $tools 'apksigner.bat') sign --ks $keystore --ks-key-alias acervo --ks-pass env:ACERVO_BUILD_KEYSTORE_PASSWORD --key-pass env:ACERVO_BUILD_KEYSTORE_PASSWORD --v4-signing-enabled false --out $signed $aligned
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao assinar APK.' }
    & (Join-Path $tools 'apksigner.bat') verify --verbose --print-certs $signed
    if ($LASTEXITCODE -ne 0) { throw 'Assinatura inválida.' }
    & (Join-Path $tools 'zipalign.exe') -c 4 $signed
    if ($LASTEXITCODE -ne 0) { throw 'Alinhamento inválido.' }
    $target = Join-Path $OutputDirectory ([System.IO.Path]::GetFileName($signed))
    Copy-Item -LiteralPath $signed -Destination $target -Force
    $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    [System.IO.File]::WriteAllText(($target + '.sha256'), $hash + '  ' + [System.IO.Path]::GetFileName($target) + "`n", $utf8)
    Write-Host ('APK pronto: ' + $target)
    Write-Host ('CLASSPATH_FILE=' + (Join-Path $stage 'app/build/extractor-classpath.txt'))
} finally {
    $env:JAVA_HOME = $oldJava
    $env:GRADLE_USER_HOME = $oldHome
    $env:PATH = $oldPath
    $env:ACERVO_BUILD_KEYSTORE_PASSWORD = $oldPass
    $env:ACERVO_MAVEN_CACHE = $oldMavenCache
}
