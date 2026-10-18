param(
    [Parameter(Mandatory = $true)][string]$JavaHome,
    [Parameter(Mandatory = $true)][string]$ZxingJar
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$javaExe = Join-Path $JavaHome 'bin/java.exe'
$javacExe = Join-Path $JavaHome 'bin/javac.exe'
foreach ($requiredFile in @($javaExe, $javacExe, $ZxingJar)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) { throw "Arquivo não encontrado: $requiredFile" }
}
$classes = Join-Path $PSScriptRoot 'classes'
$fixtures = Join-Path $PSScriptRoot 'generated'
New-Item -ItemType Directory -Force $classes | Out-Null
Push-Location $projectRoot
try {
    & node (Join-Path $PSScriptRoot 'generate-qr-fixture.mjs') $fixtures
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar o QR pelo servidor.' }
    & $javacExe -encoding UTF-8 -cp $ZxingJar -d $classes `
        (Join-Path $projectRoot 'android/app/src/main/java/br/com/acervo/app/PairingLink.java') `
        (Join-Path $PSScriptRoot 'PairingLinkTest.java') (Join-Path $PSScriptRoot 'QrBoundaryTest.java')
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar os testes Java.' }
    $testClasspath = $classes + [IO.Path]::PathSeparator + $ZxingJar
    & $javaExe -cp $testClasspath br.com.acervo.app.PairingLinkTest
    if ($LASTEXITCODE -ne 0) { throw 'PairingLinkTest falhou.' }
    & $javaExe -cp $testClasspath br.com.acervo.app.QrBoundaryTest (Join-Path $fixtures 'server-pairing.png') (Join-Path $fixtures 'server-pairing.url')
    if ($LASTEXITCODE -ne 0) { throw 'QrBoundaryTest falhou.' }
} finally {
    Pop-Location
}
