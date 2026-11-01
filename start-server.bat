@echo off
title R&S Sons Accounting Server
cd /d "%~dp0server"
where node >nul 2>nul || (echo Node.js is not installed. Download "LTS" from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist node_modules (echo First start: installing... & call npm ci --omit=dev || (echo Install failed - check internet & pause & exit /b 1))
if not exist .env if exist ..\.env.example copy ..\.env.example .env >nul
node server.js
pause
