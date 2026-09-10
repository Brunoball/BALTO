@echo off
setlocal
cd /d "%~dp0.."
node "BALTO_CONFIG\run.cjs" build comercio
if errorlevel 1 pause
