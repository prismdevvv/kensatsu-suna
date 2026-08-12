-- =====================================================================
-- Migration : photos (preuves) attachées aux dossiers d'enquête.
-- Un dossier peut avoir plusieurs photos (contrairement à la photo
-- unique d'un ninja sur son casier).
-- =====================================================================

create table if not exists dossier_photos (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid not null references dossiers_enquete(id) on delete cascade,
  photo_data  text not null,
  created_at  timestamptz not null default now()
);

alter table dossier_photos enable row level security;
create policy "anon_all_dossier_photos" on dossier_photos for all to anon using (true) with check (true);
grant select, insert, update, delete on dossier_photos to anon;

create index on dossier_photos (dossier_id);
