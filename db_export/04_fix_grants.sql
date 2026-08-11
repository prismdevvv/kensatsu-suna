-- =====================================================================
-- Correctif : accorde les privilèges de base au rôle "anon" sur les
-- tables. Les policies RLS ne suffisent pas seules — Postgres exige
-- aussi un GRANT explicite sur la table avant même de consulter RLS.
-- =====================================================================

grant select, insert, update, delete on agents               to anon;
grant select                        on articles_code_penal    to anon;
grant select, insert, update, delete on infractions           to anon;
grant select, insert, update, delete on config                to anon;

-- On ré-applique le revoke sur la colonne sensible (le grant ci-dessus
-- porte sur la table entière et pourrait redonner accès à `sceau`).
revoke select (sceau) on agents from anon, authenticated;

grant usage on schema public to anon;
