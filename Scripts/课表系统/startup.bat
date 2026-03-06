@echo off
setlocal
cd /d "%~dp0"
python obsidian_daily_update.py --startup
endlocal
