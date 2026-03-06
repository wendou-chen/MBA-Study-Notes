@echo off
setlocal
cd /d "%~dp0"
python obsidian_daily_update.py --reminder-time 22:00 --reminder-for tomorrow
endlocal
