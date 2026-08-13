-- =====================================================================
-- Migration : trace qui a forcé le retrait/l'ajout d'un service (gérance).
-- =====================================================================

alter table postes add column if not exists force_par uuid references agents(id) on delete set null;
