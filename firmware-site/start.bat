@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "URL=http://127.0.0.1:5173"

rem Сайт уже запущен (например, из другого окна) - просто открываем его.
rem Порт не меняем: библиотека прошивок привязана к адресу сайта.
netstat -ano | findstr /r /c:"127.0.0.1:5173 .*LISTENING" >nul
if not errorlevel 1 (
  echo Сайт уже запущен: %URL%
  start "" "%URL%"
  timeout /t 3 >nul
  exit /b 0
)

if not exist node_modules (
  echo Первый запуск: устанавливаю зависимости...
  call npm install
  if errorlevel 1 goto :fail
)

echo Сайт: %URL%  ^(откройте в Chrome, Edge или Яндекс Браузере^)
echo Не закрывайте это окно, пока пользуетесь сайтом.
call npm run dev -- --open
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo Не удалось запустить сайт - текст ошибки выше.
pause
exit /b 1
