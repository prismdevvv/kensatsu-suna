# Kensatsu de Sunagakure — Police & Parquet

Site de gestion pour la police/kensatsu : casiers judiciaires, émission
d'amendes selon le Code Pénal, recherche des ninjas via l'API Zenkai.
Même modèle technique que le site `seimei` (HTML/JS/CSS statique,
Supabase en base, hébergement Netlify).

## 1. Base de données (Supabase)

Dans l'éditeur SQL du projet Supabase (`hvumajktloocqtoedvkg`), exécute
dans l'ordre :

1. `db_export/01_schema.sql` — crée les tables (`agents`,
   `articles_code_penal`, `infractions`, `config`)
2. `db_export/03_seed_articles.sql` — remplit le barème du Code Pénal
3. `db_export/02_rls_et_rpc.sql` — active les RLS + la fonction de
   connexion `verifier_sceau_agent` (à exécuter en dernier, une fois
   les données en place)
4. `db_export/04_fix_grants.sql` — si tu as une erreur "permission
   denied for table ..." au premier essai, exécute ce correctif (droits
   de base au rôle `anon`, en plus des policies RLS)
5. `db_export/05_migration_grades_et_photos.sql` — uniquement si tu as
   déployé une version antérieure du site (ancien système
   agent/procureur/gérant) : bascule vers la hiérarchie de grades
   complète et ajoute la table des photos de casier

## 2. Grades et premier compte "gérant"

Les agents ont un grade parmi : `gardien_provisoire` (par défaut à
l'inscription), `gardien_confirme`, `sergent`, `lieutenant`,
`capitaine`, `commandant`, `co_gerant`, `gerant`. Seuls `co_gerant` et
`gerant` ont accès à `admin.html`.

Pour accéder à la gérance, inscris-toi d'abord normalement sur
`index.html`, puis exécute dans l'éditeur SQL :

```sql
update agents set role = 'gerant' where nom = 'TonNom' and prenom = 'TonPrenom';
```

Ensuite tu pourras promouvoir les autres agents directement depuis
`admin.html`.

## 3. Déploiement (Netlify)

- Crée un nouveau site Netlify branché sur ce repo.
- **Base directory** : `kensatsu`
- **Publish directory** : `.` (relatif à la base directory, déjà réglé
  dans `netlify.toml`)
- Pas de build command nécessaire (site statique).

## 4. Sécurité

Comme pour `seimei`, tout passe par la clé publique (`anon`) Supabase
et il n'y a pas de vraie authentification serveur — voir les
commentaires dans `db_export/02_rls_et_rpc.sql`. Les casiers judiciaires
sont des données plus sensibles qu'un planning d'hôpital : si le
serveur RP grandit, il est recommandé de migrer vers Supabase Auth pour
une vraie séparation des rôles.

Ne jamais exposer la clé **secrète** (`sb_secret_...` / `service_role`)
côté client — seule la clé publique (`sb_publishable_...`) doit
apparaître dans `common.js`.
