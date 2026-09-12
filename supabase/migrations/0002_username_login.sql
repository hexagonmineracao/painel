-- Login por usuário/senha (sem e-mail), no mesmo padrão do painel de
-- manutenção (hexagonmineracao/painel-manutencao): Supabase Auth continua
-- exigindo e-mail internamente, então usamos um e-mail sintético
-- "usuario@painel.local" que nunca é usado pra enviar nada de verdade —
-- o usuário só vê o campo "usuário" na tela de login.
--
-- Aplicado via MCP em 2026-09-12.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  full_name text,
  role text not null default 'colaborador' check (role in ('admin', 'colaborador')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Qualquer usuário logado pode listar todos os perfis (necessário pra tela
-- de "Usuários" mostrar a lista) — só criar/editar/apagar é restrito a admin.
create policy "profiles: select proprio ou admin"
  on public.profiles
  for select
  to authenticated
  using (true);

create function public.is_admin()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

create policy "profiles: admin gerencia"
  on public.profiles
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Usuários iniciais (mesmos dois administradores do painel de manutenção).
-- Os registros em auth.users foram criados via Admin API (precisa da
-- service_role key, não dá pra fazer isso só com SQL) e depois vinculados
-- aqui. Senhas padrão: thales123 / fernando123 — trocar assim que possível
-- pela própria tela de Usuários no painel.
-- insert into public.profiles (id, username, full_name, role) values
--   ('<uuid de auth.users>', 'thales', 'Thales', 'admin'),
--   ('<uuid de auth.users>', 'fernando', 'Fernando', 'admin');
