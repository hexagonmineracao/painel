@echo off
REM Gera o executavel PainelWebSync.exe a partir de sync.py
REM Uso: build.bat  (rode dentro da pasta exporter/, com o venv/python configurado)

cd /d "%~dp0"

python -m pip install -r requirements.txt
if errorlevel 1 goto :erro

REM .env fica FORA do executavel (arquivo ao lado do .exe), pra dar pra
REM editar host/senha do MySQL no PC de destino sem precisar recompilar.
python -m PyInstaller --onefile --name PainelWebSync sync.py
if errorlevel 1 goto :erro

echo.
echo Build concluido: dist\PainelWebSync.exe
goto :fim

:erro
echo.
echo ERRO no build. Veja as mensagens acima.
exit /b 1

:fim
