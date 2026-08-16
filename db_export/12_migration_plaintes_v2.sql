-- =====================================================================
-- Migration : refonte du formulaire de plainte — recherche du
-- plaignant/accusé parmi les ninjas (grade auto-rempli), moment des
-- faits, liste des articles reprochés, photo jointe.
-- =====================================================================

alter table plaintes add column if not exists plaignant_char_key text;
alter table plaintes add column if not exists plaignant_grade text;
alter table plaintes add column if not exists accuse_char_key text;
alter table plaintes add column if not exists accuse_grade text;
alter table plaintes add column if not exists moment_faits timestamptz;
alter table plaintes add column if not exists article_ids uuid[] not null default '{}';
alter table plaintes add column if not exists photo_data text;
