-- =====================================================================
-- Migration : prise de service (comme sur seimei) + registre des plaintes.
-- =====================================================================

-- --- Prise de service ---
create table if not exists postes (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid references agents(id) on delete set null,
  debut       timestamptz not null default now(),
  fin         timestamptz,
  actif       boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table postes enable row level security;
create policy "anon_all_postes" on postes for all to anon using (true) with check (true);
grant select, insert, update, delete on postes to anon;
create index on postes (agent_id);
create index on postes (actif);

-- --- Plaintes ---
create table if not exists plaintes (
  id                uuid primary key default gen_random_uuid(),
  plaignant_nom     text not null,
  mis_en_cause_nom  text,
  motif             text not null,
  statut            text not null default 'nouvelle' check (statut in ('nouvelle','en_cours','traitee','classee')),
  created_by        uuid references agents(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table plaintes enable row level security;
create policy "anon_all_plaintes" on plaintes for all to anon using (true) with check (true);
grant select, insert, update, delete on plaintes to anon;
create index on plaintes (statut);
