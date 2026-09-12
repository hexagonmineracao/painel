@echo off
REM Gera o executavel PainelWebSync.exe a partir de sync.py
REM Uso: build.bat  (rode dentro da pasta exporter/, com o venv/python configurado)

cd /d "%~dp0"

python -m pip install -r requirements.txt
if errorlevel 1 goto :erro

python -m PyInstaller --onefile --name PainelWebSync --add-data ".env;." sync.py
if errorlevel 1 goto :erro

echo.
echo Build concluido: dist\PainelWebSync.exe
goto :fim

:erro
echo.
echo ERRO no build. Veja as mensagens acima.
exit /b 1

:fim
