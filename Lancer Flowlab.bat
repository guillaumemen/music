@echo off
rem Lanceur Flowlab : double-clique sur ce fichier pour ouvrir l'app.
rem Ferme cette fenetre pour arreter le serveur.
title Flowlab
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable. Installe-le depuis https://nodejs.org puis relance.
  pause
  exit /b 1
)

echo Flowlab demarre sur http://localhost:5173
echo (ferme cette fenetre pour arreter)
start "" /b cmd /c "timeout /t 3 /nobreak >nul && start "" http://localhost:5173"
call npx --yes serve -l 5173 .
pause
