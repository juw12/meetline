@echo off
rem Serve Meetline on http://localhost:8080 (geolocation needs localhost or https).
cd /d "%~dp0"
start "" "http://localhost:8080/"
python -m http.server 8080
