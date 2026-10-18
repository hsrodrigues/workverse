@echo off
chcp 65001 >nul
title WorkVerse - Conector do PowerPoint
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale em https://nodejs.org e rode de novo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias, isso so acontece na primeira vez...
  call npm install
  if errorlevel 1 (
    echo [ERRO] npm install falhou.
    pause
    exit /b 1
  )
)

echo.
echo  Conector do PowerPoint para o WorkVerse
echo  Deixe esta janela aberta enquanto apresenta.
echo  Para usar o WorkVerse publicado em outro endereco, rode:
echo     Conector-PowerPoint.bat --origin https://seu-endereco
echo.
call npm run powerpoint:connector -- %*
pause
