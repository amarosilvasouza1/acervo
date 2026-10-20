param([Parameter(Mandatory = $true)][string]$JavaHome, [string]$SdkRoot)
$ErrorActionPreference = 'Stop'
$secureRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$secureOutput = Join-Path ([IO.Path]::GetTempPath()) ('acervo-pinned-tls-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $secureOutput | Out-Null
$secureJava = Join-Path $JavaHome 'bin/java.exe'
$secureJavac = Join-Path $JavaHome 'bin/javac.exe'
$secureKeytool = Join-Path $JavaHome 'bin/keytool.exe'
foreach ($secureName in @('trusted', 'substituted', 'expired', 'phone', 'stranger')) {
    $secureArgs = @('-genkeypair', '-alias', 'fixture', '-keyalg', 'EC', '-groupname', 'secp256r1', '-storetype', 'PKCS12', '-keystore', (Join-Path $secureOutput ($secureName + '.p12')), '-storepass', 'fixture-only', '-keypass', 'fixture-only', '-dname', 'CN=Acervo automated TLS fixture', '-noprompt')
    if ($secureName -eq 'expired') { $secureArgs += @('-startdate', '-100d', '-validity', '1') }
    else { $secureArgs += @('-validity', '2') }
    & $secureKeytool @secureArgs
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível gerar o certificado do teste.' }
}
& $secureJavac --release 11 -encoding UTF-8 -d $secureOutput `
    (Join-Path $secureRoot 'android/app/src/main/java/br/com/acervo/app/PinnedTls.java') `
    (Join-Path $secureRoot 'android/app/src/main/java/br/com/acervo/app/PairingLink.java') `
    (Join-Path $secureRoot 'android/app/src/main/java/br/com/acervo/app/TransportFailure.java') `
    (Join-Path $secureRoot 'android/app/src/main/java/br/com/acervo/app/AppEntryPolicy.java') `
    (Join-Path $PSScriptRoot 'AppEntryPolicyTest.java') `
    (Join-Path $PSScriptRoot 'TransportFailureTest.java') `
    (Join-Path $PSScriptRoot 'PinnedTlsTest.java') (Join-Path $PSScriptRoot 'PairingLinkTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o teste de TLS.' }
& $secureJava -cp $secureOutput br.com.acervo.app.AppEntryPolicyTest
if ($LASTEXITCODE -ne 0) { throw 'Falha na entrada direta do aplicativo.' }
& $secureJava -cp $secureOutput br.com.acervo.app.PairingLinkTest
if ($LASTEXITCODE -ne 0) { throw 'Falha nos limites do QR.' }
& $secureJava -cp $secureOutput br.com.acervo.app.TransportFailureTest
if ($LASTEXITCODE -ne 0) { throw 'Falha nas mensagens seguras da conexão.' }
& $secureJava -cp $secureOutput br.com.acervo.app.PinnedTlsTest `
    (Join-Path $secureOutput 'trusted.p12') (Join-Path $secureOutput 'substituted.p12') (Join-Path $secureOutput 'expired.p12') `
    (Join-Path $secureOutput 'phone.p12') (Join-Path $secureOutput 'stranger.p12')
if ($LASTEXITCODE -ne 0) { throw 'Falha na verificação real de TLS.' }
if ($SdkRoot) {
    $secureAndroidJar = Join-Path $SdkRoot 'platforms/android-35/android.jar'
    & $secureJavac --release 11 -encoding UTF-8 -classpath ($secureOutput + [IO.Path]::PathSeparator + $secureAndroidJar) -d $secureOutput `
        (Join-Path $secureRoot 'android/app/src/main/java/br/com/acervo/app/PhoneIdentity.java') `
        (Join-Path $secureRoot 'android/app/src/main/java/br/com/acervo/app/SecureTransport.java') `
        (Join-Path $PSScriptRoot 'PhoneIdentityPolicyTest.java')
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar a identidade protegida do telefone.' }
    & $secureJava -classpath ($secureOutput + [IO.Path]::PathSeparator + $secureAndroidJar) br.com.acervo.app.PhoneIdentityPolicyTest (Join-Path $secureOutput 'phone.p12')
    if ($LASTEXITCODE -ne 0) { throw 'Falha na política da identidade do telefone.' }
}
