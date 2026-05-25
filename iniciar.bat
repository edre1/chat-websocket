@echo off
cd /d "%~dp0"

for %%P in (8080 8090 5173) do (
	for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P" ^| findstr "LISTENING"') do (
		taskkill /PID %%A /F >nul 2>nul
	)
)

start "Backend" cmd /k "npm start"
timeout /t 2 /nobreak >nul
start "Cliente" cmd /k "npm run cliente"
start "Interfaz" cmd /k "cd /d interfaz && npm run dev"
