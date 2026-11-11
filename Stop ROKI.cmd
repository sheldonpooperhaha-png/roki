@echo off
title Stopping ROKI
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop.ps1"
