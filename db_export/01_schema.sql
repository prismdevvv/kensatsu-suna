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
  role        text not null default 'agent' check (role in ('agent','procureur','gerant')),
  grade       text check (grade in ('recrue','agent','inspecteur','capitaine','commandant')),
  actif       boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (nom, prenom)
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

create index on infractions (ninja_char_key);
create index on infractions (article_id);
create index on infractions (agent_id);
create index on infractions (created_at);
create index on articles_code_penal (categorie, ordre);
