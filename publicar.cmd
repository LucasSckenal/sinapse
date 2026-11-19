@echo off
rem Publica o Sinapse na Vercel. Gera o build e envia so a pasta dist, a partir de uma copia fora do repositorio
rem (no plano gratis, a Vercel bloqueia publicacoes com dados do Git de um autor que ela nao conhece).
cd /d "%~dp0"
call npm.cmd run build || exit /b 1
set DEST=%LOCALAPPDATA%\sinapse-mlp
if exist "%DEST%\.vercel" (robocopy "%DEST%\.vercel" "%TEMP%\sinapse-mlp-vercel" /e >nul)
if exist "%DEST%" rmdir /s /q "%DEST%"
robocopy "%~dp0dist" "%DEST%" /e /nfl /ndl /njh /njs >nul
if exist "%TEMP%\sinapse-mlp-vercel" (robocopy "%TEMP%\sinapse-mlp-vercel" "%DEST%\.vercel" /e >nul)
cd /d "%DEST%"
rem versao fixa: uma versao nova da Vercel nao quebra a publicacao de surpresa (o vercel.json com os cabecalhos vem do public)
call npx.cmd --yes vercel@65.12.1 deploy --prod --yes
