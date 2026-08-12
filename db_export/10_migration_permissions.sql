-- =====================================================================
-- Migration : permissions configurables par grade.
-- Le grade "gerant" garde TOUJOURS tous les droits, quoi qu'il arrive
-- (imposé côté application, pas seulement ici) — impossible de se
-- retirer l'accès par erreur en modifiant ce tableau.
-- =====================================================================

create table if not exists permissions (
  role     text not null,
  action   text not null,
  allowed  boolean not null default false,
  primary key (role, action)
);
alter table permissions enable row level security;
create policy "anon_all_permissions" on permissions for all to anon using (true) with check (true);
grant select, insert, update, delete on permissions to anon;

-- Valeurs par défaut = comportement actuel du site.
insert into permissions (role, action, allowed)
select role, action, case
  when action in ('emettre_amende','marquer_paye') then true
  when role in ('co_gerant','gerant') then true
  else false
end
from unnest(array['gardien_provisoire','gardien_confirme','sergent','lieutenant','capitaine','commandant','co_gerant','gerant']) as role
cross join unnest(array['emettre_amende','marquer_paye','supprimer_infraction','acces_dossiers','acces_gerance','gerer_agents']) as action
on conflict (role, action) do nothing;
