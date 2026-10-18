$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $root 'externo.env'
if (-not (Test-Path $envFile)) { throw 'Arquivo externo.env nao encontrado.' }
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) { throw 'Tailscale nao encontrado no PATH.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js nao encontrado no PATH.' }
$origin = $env:ACERVO_PUBLIC_ORIGIN
if (-not $origin) { throw 'Defina ACERVO_PUBLIC_ORIGIN no externo.env.' }
Write-Host 'Ligando o acesso pela tailnet (HTTPS na porta 10000)...'
tailscale serve --bg --https=10000 http://127.0.0.1:4310 | Out-Host
Write-Host ('Abrindo ' + $origin)
Start-Job -ScriptBlock { param($u) Start-Sleep -Seconds 3; Start-Process $u } -ArgumentList $origin | Out-Null
Write-Host 'Servidor iniciado. Feche esta janela para parar o acesso externo.'
node server.js
