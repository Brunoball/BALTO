@echo off
setlocal
cd /d "%~dp0.."
node "BALTO_CONFIG\run.cjs" test comercio %*
if errorlevel 1 pause
