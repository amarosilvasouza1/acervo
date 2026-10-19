param([Parameter(Mandatory = $true)][string]$JavaHome)
$ErrorActionPreference = 'Stop'
$secureRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$secureOutput = Join-Path ([IO.Path]::GetTempPath()) ('acervo-pinned-tls-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $secureOutput | Out-Null
$secureJava = Join-Path $JavaHome 'bin/java.exe'
$secureJavac = Join-Path $JavaHome 'bin/javac.exe'
$secureKeytool = Join-Path $JavaHome 'bin/keytool.exe'
foreach ($secureName in @('trusted', 'substituted', 'expired')) {
    $secureArgs = @('-genkeypair', '-alias', 'fixture', '-keyalg', 'EC', '-groupname', 'secp256r1', '-storetype', 'PKCS12', '-keystore', (Join-Path $secureOutput ($secureName + '.p12')), '-storepass', 'fixture-only', '-keypass', 'fixture-only', '-dname', 'CN=Acervo automated TLS fixture', '-noprompt')
    if ($secureName -eq 'expired') { $secureArgs += @('-startdate', '-100d', '-validity', '1') }
    else { $secureArgs += @('-validity', '2') }
    & $secureKeytool @secureArgs
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível gerar o certificado do teste.' }
}
& $secureJavac --release 11 -encoding UTF-8 -d $secureOutput `
    (Join-Path $secureRoot 'android/app/src/main/java/br/com/acervo/app/PinnedTls.java') `
    (Join-Path $secureRoot 'android/app/src/main/java/br/com/acervo/app/PairingLink.java') `
    (Join-Path $PSScriptRoot 'PinnedTlsTest.java') (Join-Path $PSScriptRoot 'PairingLinkTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o teste de TLS.' }
& $secureJava -cp $secureOutput br.com.acervo.app.PairingLinkTest
if ($LASTEXITCODE -ne 0) { throw 'Falha nos limites do QR.' }
& $secureJava -cp $secureOutput br.com.acervo.app.PinnedTlsTest `
    (Join-Path $secureOutput 'trusted.p12') (Join-Path $secureOutput 'substituted.p12') (Join-Path $secureOutput 'expired.p12')
if ($LASTEXITCODE -ne 0) { throw 'Falha na verificação real de TLS.' }
