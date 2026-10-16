@echo off
cd /d "%~dp0"
echo Publishing OnePager to GitHub...
where git >nul 2>&1 || (echo Git is not installed. & pause & exit /b 1)
if not exist .git git init -b main
git config user.name >nul 2>&1 || git config user.name "Abhay Sharma"
git config user.email >nul 2>&1 || git config user.email "vasu.abhay2003@gmail.com"
git remote get-url origin >nul 2>&1 || git remote add origin https://github.com/AbhaySharma2003/OnePager.git
git add -A
git diff --cached --quiet || git commit -q -F publish-msg.txt
git branch -M main
git push -u origin main
if errorlevel 1 (echo. & echo Upload failed. Send Claude a screenshot of this window. & pause & exit /b 1)
echo.
echo Uploaded. The site goes live at https://abhaysharma2003.github.io/OnePager/ in about a minute.
pause
