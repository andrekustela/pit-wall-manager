-- Pit Wall Manager: contas dos jogadores.
-- Rodar uma vez no Supabase: SQL Editor > New query > colar tudo > Run.

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default 'Engenheiro',
  team_name text not null default '',
  -- corridas, vitórias, pódios, poles, pontos, títulos...
  stats jsonb not null default '{}'::jsonb,
  -- campeonato solo salvo (continua de qualquer computador)
  champ jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- cada um só vê e mexe no próprio perfil
drop policy if exists "ver o proprio perfil" on public.profiles;
create policy "ver o proprio perfil" on public.profiles for select using (auth.uid() = id);
drop policy if exists "criar o proprio perfil" on public.profiles;
create policy "criar o proprio perfil" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "editar o proprio perfil" on public.profiles;
create policy "editar o proprio perfil" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
