# Painel de Pesagens — SACYR

Painel web próprio (gratuito) pra ver as pesagens do TP RODO em tempo real,
de qualquer lugar — substitui o painel pago que era instável. Não interfere
em nada no `PainelNFE` (emissão de NF-e): só lê o MySQL do TP RODO, nunca
escreve nele.

## Como funciona

```
MySQL (tprodo, na máquina da balança)
        │  SELECT somente leitura (exporter/sync.py, roda como .exe local)
        ▼
Supabase (Postgres + Realtime + Auth + Edge Functions)
        │  SELECT (login exigido) + Realtime
        ▼
Painel web estático (GitHub Pages) — web/
```

- **`exporter/`** — programa Python que roda no PC da balança, lê `tpesagens`
  (só a SACYR, `cliente=2`) e replica pro Supabase. Empacotado como
  `PainelWebSync.exe` (veja `build.bat`) e registrado como Tarefa Agendada do
  Windows pra iniciar sozinho no logon (`instalar_tarefa.ps1`).
- **`supabase/`** — schema (`migrations/`) e Edge Functions (`functions/`) do
  projeto Supabase `painel-web-sacyr` (ref `txvgqcmmbuokhfpuplsq`). As
  functions existem porque criar/apagar/redefinir senha de usuário exige a
  `service_role key`, que nunca pode ir pro navegador.
- **`web/`** — o painel em si (HTML/CSS/JS puro, sem build), publicado no
  GitHub Pages via `.github/workflows/deploy.yml` a cada push em `main`.

## Login

Login por **usuário e senha** (sem e-mail), igual ao painel de manutenção —
por baixo dos panos ainda é Supabase Auth (que exige e-mail), então cada
usuário vira um e-mail sintético `usuario@painel.local` que nunca recebe
nada de verdade.

Usuários iniciais (ambos admin — podem gerenciar outros usuários no botão
"Usuários" do painel):
- `thales` / `thales123`
- `fernando` / `fernando123`

**Troque essas senhas assim que possível** pelo próprio painel (botão
"Usuários" → "Redefinir senha").

## Exportador — instalação no PC da balança

```bash
cd exporter
copy .env.example .env      # depois edite .env com host/senha do MySQL reais
pip install -r requirements.txt
python sync.py --once       # teste: uma rodada só, confere no log
```

Se o teste funcionar, gere o executável e registre a tarefa agendada:

```bash
build.bat
```

Depois rode `instalar_tarefa.ps1` (como o próprio usuário, não precisa admin)
pra deixar o `PainelWebSync.exe` iniciando sozinho no login do Windows.

## Segurança

- `exporter/.env` (credenciais MySQL + `service_role key`) nunca é commitado
  (está no `.gitignore`). Só existe localmente no PC da balança.
- O `anon`/`publishable` key do Supabase em `web/config.js` é público de
  propósito (padrão do Supabase) — a proteção real é o RLS (só usuário
  logado lê `pesagens`) e o login.
- Criar/editar/apagar usuário sempre passa por uma Edge Function que checa
  se quem está pedindo é admin — nunca é feito direto do navegador.
