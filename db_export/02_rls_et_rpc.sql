-- =====================================================================
-- RLS + fonction de connexion — à exécuter APRÈS 01_schema.sql et
-- APRÈS 03_seed_articles.sql. Même modèle que le repo seimei (voir son
-- SECURITY.md) : pas de vraie authentification Supabase, donc toutes
-- les requêtes arrivent avec la même clé publique "anon". On ferme au
-- moins l'accès brut à la colonne `sceau`.
--
-- ATTENTION : les casiers judiciaires sont des données plus sensibles
-- qu'un planning d'hôpital. Ce modèle reste un compromis "site statique
-- sans backend" — si tu veux une vraie séparation d'accès par rôle,
-- il faudra migrer vers Supabase Auth (RLS basées sur auth.uid()).
-- =====================================================================

alter table agents               enable row level security;
alter table articles_code_penal  enable row level security;
alter table infractions          enable row level security;
alter table config               enable row level security;

-- agents : anon peut lire/écrire (nécessaire pour inscription et
-- gestion par la gérance), mais jamais la colonne sceau.
create policy "anon_select_agents" on agents for select to anon using (true);
create policy "anon_insert_agents" on agents for insert to anon with check (true);
create policy "anon_update_agents" on agents for update to anon using (true) with check (true);
create policy "anon_delete_agents" on agents for delete to anon using (true);

revoke select (sceau) on agents from anon, authenticated;

-- articles_code_penal : lecture publique, mais AUCUNE écriture depuis
-- le site (le barème ne doit être modifié qu'à la main dans l'éditeur
-- SQL Supabase, pas via l'app, pour éviter qu'un client trafiqué ne
-- réécrive les montants).
create policy "anon_select_articles" on articles_code_penal for select to anon using (true);

-- infractions : anon peut tout faire (comme shinobis/postes côté
-- seimei) — c'est la table de travail quotidien des agents.
create policy "anon_all_infractions" on infractions for all to anon using (true) with check (true);

-- config : lecture publique, écriture réservée à la gérance depuis
-- l'admin (même remarque que ci-dessus : pas de distinction de rôle
-- possible côté RLS sans vraie auth, donc ouvert en écriture pour
-- rester cohérent avec le reste du modèle).
create policy "anon_all_config" on config for all to anon using (true) with check (true);

-- --- Fonction de connexion : compare le sceau côté serveur et ne
-- renvoie jamais sa valeur.
create or replace function verifier_sceau_agent(p_nom text, p_prenom text, p_sceau_hash text)
returns table (
  id uuid, nom text, prenom text, role text, grade text,
  actif boolean, created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.nom, a.prenom, a.role, a.grade, a.actif, a.created_at
  from agents a
  where a.nom = p_nom and a.prenom = p_prenom and a.sceau = p_sceau_hash
  limit 1;
$$;

revoke all on function verifier_sceau_agent(text, text, text) from public;
grant execute on function verifier_sceau_agent(text, text, text) to anon;
