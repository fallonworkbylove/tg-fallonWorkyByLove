@echo off
cd /d "%~dp0"
if exist "dist\LoveRussian-OPS-*-portable.exe" (
  for %%F in (dist\LoveRussian-OPS-*-portable.exe) do start "" "%%F" & exit /b 0
)
where npm >nul 2>&1 || (echo Need Node.js/npm & pause & exit /b 1)
if not exist node_modules\electron (
  call npm install
)
call npx --no-install electron .
