@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Первый запуск: устанавливаю зависимости...
  call npm install
  if errorlevel 1 (
    echo Не удалось установить зависимости.
    pause
    exit /b 1
  )
)
echo Сайт: http://localhost:5173  ^(откройте в Chrome, Edge или Яндекс Браузере^)
call npm run dev -- --open
