-- =====================================================================
-- Migration : spécialisations (ex: "enquête") en plus du grade, et
-- table des dossiers d'enquête réservés aux agents spécialisés.
-- =====================================================================

alter table agents add column if not exists specialisations text[] not null default '{}';

create table if not exists dossiers_enquete (
  id           uuid primary key default gen_random_uuid(),
  titre        text not null,
  ninja_nom    text,
  description  text,
  statut       text not null default 'ouvert' check (statut in ('ouvert','en_cours','clos')),
  created_by   uuid references agents(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table dossiers_enquete enable row level security;
create policy "anon_all_dossiers_enquete" on dossiers_enquete for all to anon using (true) with check (true);
grant select, insert, update, delete on dossiers_enquete to anon;

create index on dossiers_enquete (statut);

-- La fonction de connexion doit désormais renvoyer aussi les spécialisations.
drop function if exists verifier_sceau_agent(text, text, text);
create function verifier_sceau_agent(p_nom text, p_prenom text, p_sceau_hash text)
returns table (
  id uuid, nom text, prenom text, role text, specialisations text[],
  actif boolean, created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.nom, a.prenom, a.role, a.specialisations, a.actif, a.created_at
  from agents a
  where a.nom = p_nom and a.prenom = p_prenom and a.sceau = p_sceau_hash
  limit 1;
$$;
revoke all on function verifier_sceau_agent(text, text, text) from public;
grant execute on function verifier_sceau_agent(text, text, text) to anon;
