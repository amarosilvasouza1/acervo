[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Enable', 'Disable')][string]$Action,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$internetRoot = Split-Path -Parent $PSScriptRoot
$internetPort = 4310
if ($env:PORT) {
    $internetParsedPort = 0
    if (-not [int]::TryParse($env:PORT, [ref]$internetParsedPort) -or $internetParsedPort -lt 1 -or $internetParsedPort -gt 65535) {
        Write-Host 'PORT precisa ser um numero de porta entre 1 e 65535.' -ForegroundColor Red
        exit 1
    }
    $internetPort = $internetParsedPort
}
$internetOrigin = 'http://127.0.0.1:' + $internetPort

function Read-AcervoInternetResponse {
    param([System.Net.WebResponse]$Response)
    $internetStream = $Response.GetResponseStream()
    $internetBuffer = New-Object byte[] 4096
    $internetOutput = New-Object System.IO.MemoryStream
    try {
        while (($internetCount = $internetStream.Read($internetBuffer, 0, $internetBuffer.Length)) -gt 0) {
            if ($internetOutput.Length + $internetCount -gt 262144) { throw 'O servidor retornou uma resposta maior que o esperado.' }
            $internetOutput.Write($internetBuffer, 0, $internetCount)
        }
        return [Text.Encoding]::UTF8.GetString($internetOutput.ToArray())
    } finally {
        if ($internetStream) { $internetStream.Dispose() }
        $internetOutput.Dispose()
    }
}

function Invoke-AcervoInternetApi {
    param(
        [ValidateSet('GET', 'POST')][string]$Method,
        [ValidateSet('/api/connect/config', '/api/connect/internet/enable', '/api/connect/internet/disable')][string]$Endpoint,
        [int]$TimeoutMilliseconds = 3000
    )
    $internetRequest = [Net.HttpWebRequest]::Create($internetOrigin + $Endpoint)
    $internetRequest.Proxy = $null
    $internetRequest.AllowAutoRedirect = $false
    $internetRequest.Method = $Method
    $internetRequest.Accept = 'application/json'
    $internetRequest.Headers['Origin'] = $internetOrigin
    $internetRequest.Timeout = $TimeoutMilliseconds
    $internetRequest.ReadWriteTimeout = $TimeoutMilliseconds
    $internetResponse = $null
    try {
        if ($Method -eq 'POST') {
            $internetPayload = [Text.Encoding]::UTF8.GetBytes('{}')
            $internetRequest.ContentType = 'application/json; charset=utf-8'
            $internetRequest.ContentLength = $internetPayload.Length
            $internetPayloadStream = $internetRequest.GetRequestStream()
            try { $internetPayloadStream.Write($internetPayload, 0, $internetPayload.Length) }
            finally { $internetPayloadStream.Dispose() }
        }
        $internetResponse = $internetRequest.GetResponse()
        if ([int]$internetResponse.StatusCode -lt 200 -or [int]$internetResponse.StatusCode -ge 300) {
            throw 'O Acervo respondeu com um redirecionamento inesperado. Nenhum outro servidor foi acessado.'
        }
        $internetText = Read-AcervoInternetResponse $internetResponse
        try { return ConvertFrom-Json -InputObject $internetText }
        catch { throw 'A porta local nao retornou uma resposta JSON do Acervo.' }
    } catch {
        $internetFailure = $_.Exception
        while ($internetFailure -and $internetFailure -isnot [Net.WebException] -and $internetFailure.InnerException) { $internetFailure = $internetFailure.InnerException }
        if ($internetFailure -is [Net.WebException]) {
            if ($internetFailure.Response) {
                $internetErrorResponse = $internetFailure.Response
                try {
                    $internetMessage = 'O Acervo recusou a operacao (HTTP ' + [int]$internetErrorResponse.StatusCode + '). Atualize o servidor do PC e tente novamente.'
                    try {
                        $internetErrorJson = ConvertFrom-Json -InputObject (Read-AcervoInternetResponse $internetErrorResponse)
                        if ($internetErrorJson.error -is [string] -and $internetErrorJson.error.Length -le 600) { $internetMessage = $internetErrorJson.error }
                    } catch { }
                    throw $internetMessage
                } finally { $internetErrorResponse.Dispose() }
            }
            if ($internetFailure.Status -eq [Net.WebExceptionStatus]::ConnectFailure) {
                $internetUnavailable = New-Object System.IO.IOException('O servidor local do Acervo esta desligado.')
                $internetUnavailable.Data['AcervoUnavailable'] = $true
                throw $internetUnavailable
            }
            throw 'O Acervo local nao respondeu. Confira o servidor que usa esta porta e tente novamente.'
        }
        throw
    } finally {
        if ($internetResponse) { $internetResponse.Dispose() }
        $internetRequest.Abort()
    }
}

function Assert-AcervoMutualLocal {
    param($Configuration)
    if ($Configuration.cloud -isnot [bool] -or $Configuration.cloud -ne $false -or $Configuration.security.type -ne 'mtls-pinned' -or $Configuration.security.mutual -ne $true) {
        throw 'Este acesso exige o Acervo atualizado no modo local com identidade dos dois aparelhos. Feche a instancia de nuvem ou antiga e inicie o servidor local.'
    }
}

function Start-AcervoInternetServer {
    if ($env:ACERVO_MODE -and $env:ACERVO_MODE -ne 'local') { throw 'ACERVO_MODE esta definido para outro modo. Use ACERVO_MODE=local para iniciar o PC como servidor.' }
    if ($env:ACERVO_HTTP_HOST -and $env:ACERVO_HTTP_HOST -ne '127.0.0.1') { throw 'Use ACERVO_HTTP_HOST=127.0.0.1 para manter a administracao somente neste computador.' }
    $internetNode = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $internetNode) { throw 'Node.js nao foi encontrado. Instale o Node.js e tente novamente.' }
    $internetServerFile = Join-Path $internetRoot 'server.js'
    if (-not (Test-Path -LiteralPath $internetServerFile -PathType Leaf)) { throw 'server.js nao foi encontrado na pasta do Acervo.' }
    $internetLogFolder = Join-Path $internetRoot 'data'
    if (-not (Test-Path -LiteralPath $internetLogFolder -PathType Container)) { New-Item -ItemType Directory -Path $internetLogFolder | Out-Null }
    Write-Host 'Iniciando o servidor local do Acervo...'
    $internetProcess = Start-Process -FilePath $internetNode.Source -ArgumentList @('"' + $internetServerFile + '"') `
        -WorkingDirectory $internetRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $internetLogFolder 'internet-startup.log') `
        -RedirectStandardError (Join-Path $internetLogFolder 'internet-startup-error.log')
    $internetDeadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        if ($internetProcess.HasExited) { throw 'O servidor nao iniciou. Consulte data/internet-startup-error.log na pasta do Acervo.' }
        try {
            $internetConfiguration = Invoke-AcervoInternetApi -Method GET -Endpoint '/api/connect/config' -TimeoutMilliseconds 1000
            Assert-AcervoMutualLocal $internetConfiguration
            return
        } catch {
            if (-not $_.Exception.Data['AcervoUnavailable']) { throw }
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $internetDeadline)
    throw 'O servidor ainda nao ficou pronto. Consulte data/internet-startup-error.log e tente novamente.'
}

try {
    try {
        $internetConfiguration = Invoke-AcervoInternetApi -Method GET -Endpoint '/api/connect/config'
        Assert-AcervoMutualLocal $internetConfiguration
    } catch {
        if (-not $_.Exception.Data['AcervoUnavailable']) { throw }
        if ($Action -eq 'Disable') { Write-Host 'O Acervo esta desligado. Nenhum outro encaminhamento foi alterado.'; exit 0 }
        Start-AcervoInternetServer
    }
    if ($Action -eq 'Enable') {
        Write-Host 'Ativando o encaminhamento criptografado pela internet...'
        $internetResult = Invoke-AcervoInternetApi -Method POST -Endpoint '/api/connect/internet/enable' -TimeoutMilliseconds 60000
        if ($internetResult.relay.state -ne 'online') { throw 'O servidor ainda nao confirmou o encaminhamento. Confira Dispositivos no Acervo.' }
        Write-Host 'Acesso pela internet ativado. No Acervo, abra Dispositivos e escaneie o QR pelo APK atualizado.'
        Write-Host 'A chave privada continua nos seus aparelhos. Mantenha este PC ligado para comunicar com o celular.'
        if (-not $NoBrowser) { Start-Process -FilePath ($internetOrigin + '/web') }
    } else {
        $null = Invoke-AcervoInternetApi -Method POST -Endpoint '/api/connect/internet/disable' -TimeoutMilliseconds 60000
        Write-Host 'O encaminhamento deste Acervo foi desligado. O servidor local continua funcionando.'
    }
    exit 0
} catch {
    Write-Host ('Nao foi possivel concluir: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
