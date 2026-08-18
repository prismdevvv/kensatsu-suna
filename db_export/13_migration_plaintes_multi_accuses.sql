-- =====================================================================
-- Migration : plusieurs accusés par plainte.
-- Les anciennes colonnes (mis_en_cause_nom, accuse_char_key, accuse_grade)
-- restent en place pour les plaintes déjà enregistrées ; les nouvelles
-- plaintes utilisent la colonne `accuses` (liste de {nom, char_key, grade}).
-- =====================================================================

alter table plaintes add column if not exists accuses jsonb not null default '[]'::jsonb;
