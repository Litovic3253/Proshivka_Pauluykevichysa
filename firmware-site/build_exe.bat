@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Сборка «Прошивки Паулюкевичуса.exe»

if not exist node_modules (
  echo Ставлю зависимости...
  call npm install
  if errorlevel 1 goto :fail
)

echo Собираю интерфейс...
call npm run build
if errorlevel 1 goto :fail

echo Собираю exe (1-3 минуты)...
call npx electron-builder --win portable
if errorlevel 1 goto :fail

copy /y "packaging\Как установить.txt" "dist-app\" >nul

rem Готовая программа — в рабочую папку проекта, на уровень выше.
copy /y "dist-app\Прошивки Паулюкевичуса.exe" "..\" >nul
copy /y "packaging\Как установить.txt" "..\" >nul

echo.
echo Готово: ..\Прошивки Паулюкевичуса.exe  ^(копия в dist-app^)
pause
exit /b 0

:fail
echo [ОШИБКА] Сборка не удалась, смотрите сообщения выше.
pause
exit /b 1
