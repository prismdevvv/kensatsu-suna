-- =====================================================================
-- Migration : notes d'enquête (journal chronologique) sur un dossier.
-- =====================================================================

create table if not exists dossier_notes (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid not null references dossiers_enquete(id) on delete cascade,
  contenu     text not null,
  agent_id    uuid references agents(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table dossier_notes enable row level security;
create policy "anon_all_dossier_notes" on dossier_notes for all to anon using (true) with check (true);
grant select, insert, update, delete on dossier_notes to anon;

create index on dossier_notes (dossier_id);
