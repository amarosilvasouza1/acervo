@echo off
setlocal
set "FILE=%~dp0externo.env"
if not exist "%FILE%" (
  echo Arquivo externo.env nao encontrado.
  pause
  exit /b 1
)
set "PASS="
for /f "usebackq tokens=1,* delims==" %%A in ("%FILE%") do (
  if /i "%%A"=="ACERVO_ADMIN_PASSWORD" set "PASS=%%B"
)
if not defined PASS (
  echo Senha nao encontrada no externo.env.
  pause
  exit /b 1
)
echo %PASS%| clip
echo.
echo Senha copiada para a area de transferencia.
echo Cole no campo "Senha do seu Acervo" e clique em Entrar.
echo O celular nao precisa dela: conecte pelo QR code.
echo.
pause
