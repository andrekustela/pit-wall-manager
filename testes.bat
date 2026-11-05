@echo off
rem Pit Wall - testes: liga o servidor de teste (se estiver desligado) e abre a pagina de testes
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
netstat -ano | findstr ":5179" | findstr "LISTENING" >nul
if errorlevel 1 (
  start "Pit Wall - servidor de teste (pode minimizar)" /min cmd /c "npm run dev -- --port 5179"
  timeout /t 5 /nobreak >nul
)
start "" "http://localhost:5179/testes.html"
