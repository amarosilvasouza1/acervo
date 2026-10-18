[CmdletBinding()]
param(
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$SdkRoot = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }),
    [string]$ZxingJar,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'acervo-apk-build'
$signingRoot = Join-Path $PSScriptRoot 'signing'
$toolchainPath = Join-Path ([System.IO.Path]::GetTempPath()) 'acervo-android-toolchain/toolchain.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Require-File([string]$Path, [string]$Description) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Description ausente: $Path"
    }
    return (Get-Item -LiteralPath $Path).FullName
}

function Invoke-BuildTool([string]$Executable, [string[]]$ToolArguments) {
    & $Executable @ToolArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Falha em $([System.IO.Path]::GetFileName($Executable)) (codigo $LASTEXITCODE)."
    }
}

# A preparacao do ambiente pode gravar este cache. Nenhum download ocorre aqui.
if (Test-Path -LiteralPath $toolchainPath -PathType Leaf) {
    $toolchain = Get-Content -LiteralPath $toolchainPath -Raw | ConvertFrom-Json
    if (-not $JavaHome) { $JavaHome = $toolchain.javaHome }
    if (-not $SdkRoot) { $SdkRoot = $toolchain.sdkRoot }
    if (-not $ZxingJar) { $ZxingJar = $toolchain.zxingJar }
}
if (-not $JavaHome -or -not $SdkRoot -or -not $ZxingJar) {
    throw 'Informe -JavaHome (JDK 17 ou 21), -SdkRoot (Android SDK) e -ZxingJar (ZXing core 3.5.4). Consulte android/README.md.'
}
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'releases' }

$java = Require-File (Join-Path $JavaHome 'bin/java.exe') 'Java'
$javac = Require-File (Join-Path $JavaHome 'bin/javac.exe') 'Compilador Java'
$jar = Require-File (Join-Path $JavaHome 'bin/jar.exe') 'Empacotador Java'
$keytool = Require-File (Join-Path $JavaHome 'bin/keytool.exe') 'Keytool'
$ZxingJar = Require-File $ZxingJar 'ZXing core'
$androidJar = Require-File (Join-Path $SdkRoot 'platforms/android-35/android.jar') 'Android SDK Platform 35'
$buildToolsRoot = Join-Path $SdkRoot 'build-tools/35.0.0'
$aapt2 = Require-File (Join-Path $buildToolsRoot 'aapt2.exe') 'Android Build Tools 35.0.0 (aapt2)'
$d8 = Require-File (Join-Path $buildToolsRoot 'd8.bat') 'Android Build Tools 35.0.0 (d8)'
$zipalign = Require-File (Join-Path $buildToolsRoot 'zipalign.exe') 'Android Build Tools 35.0.0 (zipalign)'
$apksigner = Require-File (Join-Path $buildToolsRoot 'apksigner.bat') 'Android Build Tools 35.0.0 (apksigner)'
$originalManifestPath = Require-File (Join-Path $PSScriptRoot 'app/src/main/AndroidManifest.xml') 'Manifesto Android'
$originalSourceRoot = Join-Path $PSScriptRoot 'app/src/main/java'
$originalResourceRoot = Join-Path $PSScriptRoot 'app/src/main/res'

[xml]$manifest = Get-Content -LiteralPath $originalManifestPath -Raw
$androidNamespace = 'http://schemas.android.com/apk/res/android'
$versionName = $manifest.manifest.GetAttribute('versionName', $androidNamespace)
if (-not $versionName -or $versionName -notmatch '^[A-Za-z0-9._-]+$') {
    throw 'O manifesto precisa declarar android:versionName com letras, numeros, pontos ou hifens.'
}
$minimumSdk = $manifest.manifest.'uses-sdk'.GetAttribute('minSdkVersion', $androidNamespace)
if (-not $minimumSdk) { $minimumSdk = '26' }

New-Item -ItemType Directory -Path $buildRoot, $signingRoot, $OutputDirectory -Force | Out-Null
$OutputDirectory = (Get-Item -LiteralPath $OutputDirectory).FullName
# Cada compilacao recebe uma pasta nova; arquivos de outra execucao nunca entram no APK.
$runRoot = Join-Path $buildRoot ([Guid]::NewGuid().ToString('N'))
if ($runRoot -match '[^\x00-\x7F]') {
    throw 'As ferramentas nativas do Android exigem uma pasta TEMP sem acentos. Defina TEMP e TMP para uma pasta local com caminho ASCII e compile novamente.'
}
$generatedRoot = Join-Path $runRoot 'generated'
$classesRoot = Join-Path $runRoot 'classes'
$dexRoot = Join-Path $runRoot 'dex'
New-Item -ItemType Directory -Path $runRoot, $generatedRoot, $classesRoot, $dexRoot -Force | Out-Null
# aapt2 e zipalign no Windows nao aceitam todos os caminhos Unicode. Copiamos
# somente os fontes para TEMP e so entregamos o APK depois de valida-lo.
$manifestPath = Join-Path $runRoot 'AndroidManifest.xml'
$sourceRoot = Join-Path $runRoot 'java'
$resourceRoot = Join-Path $runRoot 'res'
Copy-Item -LiteralPath $originalManifestPath -Destination $manifestPath
Copy-Item -LiteralPath $originalSourceRoot -Destination $sourceRoot -Recurse
Copy-Item -LiteralPath $originalResourceRoot -Destination $resourceRoot -Recurse
$stagedAndroidJar = Join-Path $runRoot 'android.jar'
$stagedZxingJar = Join-Path $runRoot 'zxing-core.jar'
Copy-Item -LiteralPath $androidJar -Destination $stagedAndroidJar
Copy-Item -LiteralPath $ZxingJar -Destination $stagedZxingJar
$androidJar = $stagedAndroidJar
$ZxingJar = $stagedZxingJar
$compiledResources = Join-Path $runRoot 'resources.zip'
$resourceApk = Join-Path $runRoot 'resources.apk'
$unsignedApk = Join-Path $runRoot 'unsigned.apk'
$alignedApk = Join-Path $runRoot 'aligned.apk'
$classesJar = Join-Path $runRoot 'classes.jar'
$apkPath = Join-Path $OutputDirectory "acervo-$versionName.apk"
$stagedApkPath = Join-Path $runRoot "acervo-$versionName.apk"
$keystorePath = Join-Path $signingRoot 'acervo-release.jks'
$passwordPath = Join-Path $signingRoot 'password.txt'
$oldJavaHome = $env:JAVA_HOME
$oldPath = $env:PATH
$oldPassword = $env:ACERVO_BUILD_KEYSTORE_PASSWORD
$oldLocation = Get-Location

try {
    Set-Location -LiteralPath $runRoot
    $env:JAVA_HOME = (Get-Item -LiteralPath $JavaHome).FullName
    $env:PATH = (Join-Path $JavaHome 'bin') + [System.IO.Path]::PathSeparator + $env:PATH

    Write-Host 'Compilando recursos Android...'
    Invoke-BuildTool $aapt2 @('compile', '--dir', $resourceRoot, '-o', $compiledResources)
    Invoke-BuildTool $aapt2 @('link', '-o', $resourceApk, '-I', $androidJar, '--manifest', $manifestPath, '--java', $generatedRoot, '--min-sdk-version', $minimumSdk, '--target-sdk-version', '35', $compiledResources)

    Write-Host 'Compilando aplicativo e leitor de QR code...'
    $javaSources = @(Get-ChildItem -LiteralPath $sourceRoot, $generatedRoot -Filter '*.java' -File -Recurse | Sort-Object FullName)
    if ($javaSources.Count -eq 0) { throw 'Nenhum fonte Java encontrado.' }
    $sourceList = Join-Path $runRoot 'java-sources.txt'
    $sourceLines = @($javaSources | ForEach-Object { '"' + $_.FullName.Replace('\', '/') + '"' })
    [System.IO.File]::WriteAllLines($sourceList, $sourceLines, $utf8)
    # --release supplies the Java 8 lambda bootstrap symbols absent from
    # android.jar stubs; D8 desugars lambdas for the Android runtime afterward.
    Invoke-BuildTool $javac @('-encoding', 'UTF-8', '--release', '8', '-classpath', ($androidJar + [System.IO.Path]::PathSeparator + $ZxingJar), '-d', $classesRoot, ('@' + $sourceList))
    Invoke-BuildTool $jar @('--create', '--file', $classesJar, '-C', $classesRoot, '.')
    Invoke-BuildTool $d8 @('--release', '--lib', $androidJar, '--min-api', $minimumSdk, '--output', $dexRoot, $classesJar, $ZxingJar)

    Copy-Item -LiteralPath $resourceApk -Destination $unsignedApk
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::Open($unsignedApk, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        $dexFiles = @(Get-ChildItem -LiteralPath $dexRoot -Filter '*.dex' -File)
        if ($dexFiles.Count -eq 0) { throw 'D8 nao gerou classes.dex.' }
        foreach ($dexFile in $dexFiles) {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $dexFile.FullName, $dexFile.Name, [System.IO.Compression.CompressionLevel]::NoCompression) | Out-Null
        }
    } finally { $zip.Dispose() }
    Invoke-BuildTool $zipalign @('-f', '4', $unsignedApk, $alignedApk)

    # A mesma chave permite instalar atualizacoes sem desinstalar o aplicativo.
    if ((Test-Path -LiteralPath $keystorePath) -and -not (Test-Path -LiteralPath $passwordPath)) {
        throw 'A chave de assinatura existe, mas signing/password.txt esta ausente. Restaure a senha do backup para preservar as atualizacoes.'
    }
    if (-not (Test-Path -LiteralPath $passwordPath)) {
        $randomBytes = New-Object byte[] 32
        $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
        [System.IO.File]::WriteAllText($passwordPath, [Convert]::ToBase64String($randomBytes), $utf8)
    }
    $env:ACERVO_BUILD_KEYSTORE_PASSWORD = [System.IO.File]::ReadAllText($passwordPath).Trim()
    if (-not $env:ACERVO_BUILD_KEYSTORE_PASSWORD) { throw 'O arquivo signing/password.txt esta vazio.' }
    if (-not (Test-Path -LiteralPath $keystorePath)) {
        Write-Host 'Criando chave local de assinatura para as proximas atualizacoes...'
        Invoke-BuildTool $keytool @('-genkeypair', '-noprompt', '-storetype', 'JKS', '-keystore', $keystorePath, '-alias', 'acervo', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Acervo pessoal, OU=Acervo, O=Acervo, C=BR', '-storepass:env', 'ACERVO_BUILD_KEYSTORE_PASSWORD', '-keypass:env', 'ACERVO_BUILD_KEYSTORE_PASSWORD')
    }
    Write-Host 'Assinando e verificando APK...'
    Invoke-BuildTool $apksigner @('sign', '--ks', $keystorePath, '--ks-key-alias', 'acervo', '--ks-pass', 'env:ACERVO_BUILD_KEYSTORE_PASSWORD', '--key-pass', 'env:ACERVO_BUILD_KEYSTORE_PASSWORD', '--v4-signing-enabled', 'false', '--out', $stagedApkPath, $alignedApk)
    Invoke-BuildTool $apksigner @('verify', '--verbose', '--print-certs', $stagedApkPath)
    Invoke-BuildTool $zipalign @('-c', '4', $stagedApkPath)

    $hash = (Get-FileHash -LiteralPath $stagedApkPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Copy-Item -LiteralPath $stagedApkPath -Destination $apkPath -Force
    $hashPath = $apkPath + '.sha256'
    [System.IO.File]::WriteAllText($hashPath, "$hash  $([System.IO.Path]::GetFileName($apkPath))`n", $utf8)
    Write-Host "APK pronto: $apkPath"
    Write-Host "SHA256: $hash"
} finally {
    Set-Location -LiteralPath $oldLocation.Path
    $env:JAVA_HOME = $oldJavaHome
    $env:PATH = $oldPath
    $env:ACERVO_BUILD_KEYSTORE_PASSWORD = $oldPassword
}
