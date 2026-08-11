-- =====================================================================
-- Migration à exécuter sur le projet Supabase déjà en place :
--   1. Remplace les rôles agent/procureur/gerant par la hiérarchie
--      complète de la kensatsu.
--   2. Supprime la colonne `grade` (devenue redondante avec `role`).
--   3. Ajoute la table `casier_photos` (photo collée par Ctrl+V sur la
--      fiche d'un ninja).
-- =====================================================================

-- --- 1) Grades ---
update agents set role = 'gardien_provisoire' where role = 'agent';
update agents set role = 'sergent'            where role = 'procureur';

alter table agents drop constraint if exists agents_role_check;
alter table agents add constraint agents_role_check
  check (role in (
    'gardien_provisoire','gardien_confirme','sergent','lieutenant',
    'capitaine','commandant','co_gerant','gerant'
  ));
alter table agents alter column role set default 'gardien_provisoire';
alter table agents drop column if exists grade;

drop function if exists verifier_sceau_agent(text, text, text);
create function verifier_sceau_agent(p_nom text, p_prenom text, p_sceau_hash text)
returns table (
  id uuid, nom text, prenom text, role text,
  actif boolean, created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.nom, a.prenom, a.role, a.actif, a.created_at
  from agents a
  where a.nom = p_nom and a.prenom = p_prenom and a.sceau = p_sceau_hash
  limit 1;
$$;
revoke all on function verifier_sceau_agent(text, text, text) from public;
grant execute on function verifier_sceau_agent(text, text, text) to anon;

-- --- 2) Photo de la fiche (mugshot) ---
create table if not exists casier_photos (
  ninja_char_key text primary key,
  photo_data     text not null,
  updated_by     uuid references agents(id) on delete set null,
  updated_at     timestamptz not null default now()
);
alter table casier_photos enable row level security;
create policy "anon_all_casier_photos" on casier_photos for all to anon using (true) with check (true);
grant select, insert, update, delete on casier_photos to anon;
