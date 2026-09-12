-- Espelho (somente leitura pro navegador) das pesagens da SACYR no TP RODO.
-- Aplicado no projeto Supabase "painel-web-sacyr" (ref: txvgqcmmbuokhfpuplsq)
-- via MCP em 2026-09-12. Mantido aqui só como registro/histórico — para
-- alterar o schema de verdade, rode uma nova migration no Supabase.

create table public.pesagens (
  id integer primary key,              -- idtpesagens do TP RODO
  numero_pesagem integer,
  placa_veiculo text,
  nome_motorista text,
  nome_transportadora text,
  produto text,
  peso_real_kg numeric,
  tara_kg numeric,
  data_entrada date,
  hora_entrada time,
  tipo_operacao text,
  fiscal_danfe text,
  chave_nfe text,
  cliente_codigo integer,
  cliente_nome text,
  atualizado_em timestamptz not null default now()
);

create index idx_pesagens_data_entrada on public.pesagens (data_entrada);

alter table public.pesagens enable row level security;

-- Só usuários logados (Supabase Auth) podem ler. Nenhuma policy de
-- insert/update/delete é criada de propósito: só a service_role key
-- (usada pelo exportador local, nunca pelo navegador) escreve nessa tabela,
-- porque ela ignora RLS.
create policy "pesagens_select_authenticated"
  on public.pesagens
  for select
  to authenticated
  using (true);

alter publication supabase_realtime add table public.pesagens;
