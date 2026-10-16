@echo off
cd /d "%~dp0"
rem Stop an older OnePager preview still running on port 3000
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1
echo Starting OnePager at http://localhost:3000  (keep this window open; close it to stop)
start "" /min cmd /c "timeout /t 6 >nul & start http://localhost:3000"
npx.cmd serve web -l 3000
