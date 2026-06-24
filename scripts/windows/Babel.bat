@echo off
REM Double-click this to open the Babel installer window (no Node.js required).
REM -STA is required for the WinForms GUI; -ExecutionPolicy Bypass lets the
REM bundled, unsigned scripts run for this launch only.
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0Babel-Manager.ps1"
