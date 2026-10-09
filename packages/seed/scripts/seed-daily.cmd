@echo off
rem Runs the daily test-order seeder and appends to packages\seed\out\daily.log (git-ignored).
rem Scheduled by: schtasks /create /tn "ProfitIntelligence-SeedDaily" ... (see docs/development/test-data.md)
cd /d "%~dp0..\..\.."
if not exist packages\seed\out mkdir packages\seed\out
echo [%date% %time%] pnpm seed:daily >> packages\seed\out\daily.log
call pnpm seed:daily >> packages\seed\out\daily.log 2>&1
echo [%date% %time%] exit %errorlevel% >> packages\seed\out\daily.log
