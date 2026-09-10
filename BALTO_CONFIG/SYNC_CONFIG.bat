@echo off
setlocal
cd /d "%~dp0.."
node "BALTO_CONFIG\run.cjs" sync
if errorlevel 1 pause
