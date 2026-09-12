#!/usr/bin/env python3
"""
sync.py — Exportador PainelWebSync
======================================
Le pesagens do MySQL do TP RODO (somente SELECT, nunca escreve) e replica
pra uma tabela no Supabase, pro painel web remoto ler em tempo real.

Totalmente independente do PainelNFE (pasta NFE/): nao importa nenhum
arquivo de la, so reusa os MESMOS valores de conexao MySQL (copiados pra
.env deste projeto). Nunca alterar NFE/config.py a partir daqui.

Uso:
    python sync.py            # loop continuo (producao)
    python sync.py --once     # uma unica rodada (teste)
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from datetime import date, timedelta
from decimal import Decimal
from logging.handlers import RotatingFileHandler
from pathlib import Path

import pymysql
import requests
from dotenv import load_dotenv
from pymysql.cursors import DictCursor

if sys.platform == "win32":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

# Quando empacotado com PyInstaller (--onefile), __file__ aponta pra uma
# pasta temporária de extração — o .env precisa ficar visível e editável do
# lado de fora, na pasta real do .exe (sys.executable), não dentro do
# bundle. Sem isso, trocar a senha do MySQL no PC de destino exigiria
# recompilar o executável a cada vez.
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys.executable).resolve().parent
else:
    BASE_DIR = Path(__file__).resolve().parent

load_dotenv(BASE_DIR / ".env")

MYSQL = {
    "host": os.getenv("TPMYSQL_HOST", "localhost"),
    "port": int(os.getenv("TPMYSQL_PORT", "3306")),
    "user": os.getenv("TPMYSQL_USER", "tpoperador"),
    "password": os.getenv("TPMYSQL_PASSWORD", ""),
    "database": os.getenv("TPMYSQL_DATABASE", "tprodo"),
    "charset": "utf8mb4",
    "connect_timeout": 10,
    "read_timeout": 10,
    "write_timeout": 10,
    "autocommit": True,
}

CLIENTE_CODIGO = int(os.getenv("CLIENTE_CODIGO", "2"))
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SYNC_WINDOW_DIAS = int(os.getenv("SYNC_WINDOW_DIAS", "120"))
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "15"))

STATE_FILE = BASE_DIR / "sync_state.json"
LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

BATCH_SIZE = 500
MAX_RECONNECT_DELAY = 60

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------


def _setup_logger() -> logging.Logger:
    log = logging.getLogger("painel_web_sync")
    log.setLevel(logging.DEBUG)

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    )

    fh = RotatingFileHandler(
        LOG_DIR / "sync.log", maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)
    log.addHandler(fh)

    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)
    log.addHandler(ch)

    return log


LOG = _setup_logger()

# ---------------------------------------------------------------------------
# Estado local (watermark de idtpesagens ja sincronizado)
# ---------------------------------------------------------------------------


def carregar_estado() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            LOG.warning("sync_state.json corrompido — reiniciando do zero.")
    return {"last_max_id": 0}


def salvar_estado(estado: dict) -> None:
    STATE_FILE.write_text(json.dumps(estado), encoding="utf-8")


# ---------------------------------------------------------------------------
# MySQL — somente leitura
# ---------------------------------------------------------------------------

SELECT_PESAGENS = """SELECT
    idtpesagens, numeroPesagem, placaVeiculo, nomeMotorista, nomeTransportadora,
    descricaoProduto, pesoReal, tara, dataEntrada, horaEntrada, tipoOperacao,
    fiscalDanfe, chaveNFe, cliente, nomeCliente
FROM tpesagens
WHERE cliente = %s
  AND status = 'FECHADA'
  AND (dataEntrada >= %s OR idtpesagens > %s)
ORDER BY idtpesagens ASC"""


def conectar_mysql() -> pymysql.Connection:
    return pymysql.connect(**MYSQL, cursorclass=DictCursor)


def buscar_pesagens(conn: pymysql.Connection, last_max_id: int) -> list[dict]:
    cutoff = date.today() - timedelta(days=SYNC_WINDOW_DIAS)
    with conn.cursor() as cur:
        cur.execute(SELECT_PESAGENS, (CLIENTE_CODIGO, cutoff, last_max_id))
        return cur.fetchall()


def _num(v):
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v)
    return v


def montar_payload(pesagens: list[dict]) -> list[dict]:
    linhas = []
    for p in pesagens:
        linhas.append(
            {
                "id": p["idtpesagens"],
                "numero_pesagem": p.get("numeroPesagem"),
                "placa_veiculo": p.get("placaVeiculo"),
                "nome_motorista": p.get("nomeMotorista"),
                "nome_transportadora": p.get("nomeTransportadora"),
                "produto": p.get("descricaoProduto"),
                "peso_real_kg": _num(p.get("pesoReal")),
                "tara_kg": _num(p.get("tara")),
                "data_entrada": str(p["dataEntrada"]) if p.get("dataEntrada") else None,
                "hora_entrada": str(p["horaEntrada"]) if p.get("horaEntrada") else None,
                "tipo_operacao": p.get("tipoOperacao"),
                "fiscal_danfe": p.get("fiscalDanfe"),
                "chave_nfe": p.get("chaveNFe"),
                "cliente_codigo": p.get("cliente"),
                "cliente_nome": p.get("nomeCliente"),
            }
        )
    return linhas


# ---------------------------------------------------------------------------
# Supabase — upsert via REST (service_role key, ignora RLS)
# ---------------------------------------------------------------------------


def enviar_supabase(linhas: list[dict]) -> None:
    if not linhas:
        return
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    url = f"{SUPABASE_URL}/rest/v1/pesagens"
    for i in range(0, len(linhas), BATCH_SIZE):
        lote = linhas[i : i + BATCH_SIZE]
        resp = requests.post(
            url, params={"on_conflict": "id"}, headers=headers, json=lote, timeout=30
        )
        if resp.status_code not in (200, 201, 204):
            raise RuntimeError(
                f"Supabase upsert falhou (HTTP {resp.status_code}): {resp.text[:300]}"
            )


# ---------------------------------------------------------------------------
# Ciclo principal
# ---------------------------------------------------------------------------


def rodar_ciclo(estado: dict) -> int:
    """Executa um ciclo de sync. Retorna quantas pesagens foram enviadas."""
    conn = conectar_mysql()
    try:
        pesagens = buscar_pesagens(conn, estado["last_max_id"])
    finally:
        conn.close()

    if not pesagens:
        return 0

    linhas = montar_payload(pesagens)
    enviar_supabase(linhas)

    novo_max = max(p["idtpesagens"] for p in pesagens)
    if novo_max > estado["last_max_id"]:
        estado["last_max_id"] = novo_max
        salvar_estado(estado)

    return len(linhas)


def validar_config() -> None:
    problemas = []
    if not SUPABASE_URL:
        problemas.append("SUPABASE_URL nao configurado em .env")
    if not SUPABASE_SERVICE_ROLE_KEY:
        problemas.append("SUPABASE_SERVICE_ROLE_KEY nao configurado em .env")
    if problemas:
        for p in problemas:
            LOG.error("Config: %s", p)
        sys.exit(1)


def main() -> None:
    validar_config()
    estado = carregar_estado()

    LOG.info("=" * 60)
    LOG.info("PainelWebSync — exportador MySQL (TP RODO) -> Supabase")
    LOG.info(
        "MySQL: %s:%s/%s | cliente=%s | janela=%dd | intervalo=%ds",
        MYSQL["host"], MYSQL["port"], MYSQL["database"],
        CLIENTE_CODIGO, SYNC_WINDOW_DIAS, POLL_INTERVAL_SECONDS,
    )
    LOG.info("=" * 60)

    reconnect_delay = 1
    while True:
        try:
            qtd = rodar_ciclo(estado)
            if qtd:
                LOG.info("Sincronizadas %d pesagem(ns).", qtd)
            reconnect_delay = 1
        except (pymysql.Error, ConnectionError) as e:
            LOG.error("Erro de conexao MySQL: %s. Tentando de novo em %ds...", e, reconnect_delay)
            time.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, MAX_RECONNECT_DELAY)
            continue
        except Exception as e:
            LOG.error("Erro no ciclo de sync: %s", e, exc_info=True)

        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    if "--once" in sys.argv:
        validar_config()
        estado = carregar_estado()
        qtd = rodar_ciclo(estado)
        LOG.info("Rodada unica concluida — %d pesagem(ns) sincronizada(s).", qtd)
        sys.exit(0)

    main()
