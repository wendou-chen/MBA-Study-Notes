@echo off
setlocal
cd /d "%~dp0"
python obsidian_daily_update.py --reminder-time 07:00 --reminder-for today
endlocal
