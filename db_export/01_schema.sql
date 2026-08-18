-- =====================================================================
-- Schéma du projet Supabase — Kensatsu de Sunagakure (police / parquet)
-- À exécuter en premier, dans l'éditeur SQL du NOUVEAU projet Supabase.
-- =====================================================================

create extension if not exists pgcrypto;

create table agents (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null check (char_length(nom) between 1 and 60),
  prenom      text not null check (char_length(prenom) between 1 and 60),
  sceau       text not null,
  role        text not null default 'gardien_provisoire' check (role in (
                'gardien_provisoire','gardien_confirme','sergent','lieutenant',
                'capitaine','commandant','co_gerant','gerant'
              )),
  specialisations text[] not null default '{}',
  actif       boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (nom, prenom)
);

-- Photo (mugshot) collée par Ctrl+V sur la fiche d'un ninja.
create table casier_photos (
  ninja_char_key text primary key,
  photo_data     text not null,
  updated_by     uuid references agents(id) on delete set null,
  updated_at     timestamptz not null default now()
);

-- Le code pénal : une ligne par article (rempli par 03_seed_articles.sql).
create table articles_code_penal (
  id                 uuid primary key default gen_random_uuid(),
  categorie          text not null check (categorie in ('mineur','majeur','crime')),
  code               text not null unique,        -- ex: '1.1', '2.12', '3.4'
  libelle            text not null,
  amende             integer not null,             -- montant de base en Ryos
  cellule_minutes    integer,                       -- null = N/A
  comparution        boolean not null default false,
  jugement           text not null default 'non' check (jugement in ('non','oui','attente')),
  ordre              integer not null,
  created_at         timestamptz not null default now()
);

-- Une infraction = une amende émise contre un ninja, rattachée à son
-- casier judiciaire. `ninja_char_key` est la clé de personnage renvoyée
-- par l'API Zenkai (db.builtbyloris.dev) — pas de duplication des
-- données de personnage, seulement une référence + un nom en cache.
create table infractions (
  id                      uuid primary key default gen_random_uuid(),
  ninja_char_key          text not null,
  ninja_nom               text not null,
  article_id              uuid not null references articles_code_penal(id) on delete restrict,
  montant                 integer not null,
  recidive_niveau         integer not null default 0 check (recidive_niveau in (0,1,2)),
  circonstance_aggravante boolean not null default false,
  cellule_minutes         integer,
  comparution             boolean not null default false,
  jugement                text not null default 'non' check (jugement in ('non','oui','attente')),
  paye                    boolean not null default false,
  paid_at                 timestamptz,
  commentaire             text,
  agent_id                uuid references agents(id) on delete set null,
  created_at              timestamptz not null default now()
);

create table config (
  cle     text primary key,
  valeur  text
);

-- Dossiers d'enquête, réservés aux agents avec la spécialisation 'enquete'
-- (ou à la gérance) — indépendant des infractions/amendes.
create table dossiers_enquete (
  id           uuid primary key default gen_random_uuid(),
  titre        text not null,
  ninja_nom    text,
  description  text,
  statut       text not null default 'ouvert' check (statut in ('ouvert','en_cours','clos')),
  created_by   uuid references agents(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on dossiers_enquete (statut);

-- Photos (preuves) attachées à un dossier d'enquête — plusieurs par dossier.
create table dossier_photos (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid not null references dossiers_enquete(id) on delete cascade,
  photo_data  text not null,
  created_at  timestamptz not null default now()
);
create index on dossier_photos (dossier_id);

-- Journal chronologique de notes d'enquête sur un dossier.
create table dossier_notes (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid not null references dossiers_enquete(id) on delete cascade,
  contenu     text not null,
  agent_id    uuid references agents(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on dossier_notes (dossier_id);

-- Prise de service (comme seimei) — ouverte 18h30-3h, cf. app.js.
create table postes (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid references agents(id) on delete set null,
  debut       timestamptz not null default now(),
  fin         timestamptz,
  actif       boolean not null default true,
  force_par   uuid references agents(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on postes (agent_id);
create index on postes (actif);

-- Plaintes déposées par un ninja contre un autre.
create table plaintes (
  id                 uuid primary key default gen_random_uuid(),
  plaignant_nom      text not null,
  plaignant_char_key text,
  plaignant_grade    text,
  mis_en_cause_nom   text,
  accuse_char_key    text,
  accuse_grade       text,
  accuses            jsonb not null default '[]'::jsonb,
  moment_faits       timestamptz,
  article_ids        uuid[] not null default '{}',
  motif              text not null,
  photo_data         text,
  statut             text not null default 'nouvelle' check (statut in ('nouvelle','en_cours','traitee','classee')),
  created_by         uuid references agents(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on plaintes (statut);

create index on infractions (ninja_char_key);
create index on infractions (article_id);
create index on infractions (agent_id);
create index on infractions (created_at);
create index on articles_code_penal (categorie, ordre);
