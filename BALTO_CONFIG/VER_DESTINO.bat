@echo off
setlocal
cd /d "%~dp0.."
node "BALTO_CONFIG\run.cjs" status
pause
