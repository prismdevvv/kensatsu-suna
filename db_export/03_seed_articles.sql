-- =====================================================================
-- Remplissage du barème du Code Pénal de Sunagakure — à exécuter APRÈS
-- 01_schema.sql. Repris tel quel des tableaux fournis (délits mineurs,
-- délits majeurs, crimes).
--
-- Rappel des règles générales (affichées aussi dans l'app, appliquées
-- automatiquement au moment d'émettre une amende) :
--   - Récidive sous 1 an : 1ère récidive +20%, 2e récidive +40%
--   - Circonstance aggravante (tout ce qui concerne le Haut
--     Commandement / les agents) : amende ×2
-- =====================================================================

insert into articles_code_penal (categorie, code, libelle, amende, cellule_minutes, comparution, jugement, ordre) values
-- ── Délits mineurs ──────────────────────────────────────────────────
('mineur', '1.1',  'Saut ou course de chakra dans le village', 25000, null, false, 'non',    1),
('mineur', '1.2',  'Utilisation de jutsu/taijutsu/autres en dehors des zones d''entrainement', 16000, null, false, 'non', 2),
('mineur', '1.3',  'Port du masque dans le village sans autorisation', 14000, null, false, 'non', 3),
('mineur', '1.4',  'Circuler sur les toits / murailles', 25000, null, false, 'non', 4),
('mineur', '1.5',  'Perturber l''ordre publique', 12000, 5, true, 'attente', 5),
('mineur', '1.6',  'Entrer dans les bâtiments interdits / section sans autorisation', 14000, null, false, 'non', 6),
('mineur', '1.7',  'Manquement à son devoir de ninja', 16000, null, true, 'attente', 7),
('mineur', '1.8',  'Appel à la cloche inutile (faire un appel à la cloche pour une personne, appel à la cloche non conforme)', 8000, null, false, 'non', 8),
('mineur', '1.9',  'Entrée dans l''hôpital sans raison spécifique/autorisation', 8000, null, false, 'non', 9),
('mineur', '1.10', 'Combat devant le village', 18000, null, false, 'non', 10),
('mineur', '1.11', 'Non respect du protocole', 16000, null, false, 'non', 11),
('mineur', '1.12', 'Tenue inappropriée (nudité, tenue exentrique, ...)', 8000, null, false, 'non', 12),
-- ── Délits majeurs ──────────────────────────────────────────────────
('majeur', '2.1',  'Manque de respect ou insulte envers un agent', 25000, 15, false, 'non', 13),
('majeur', '2.2',  'Délit de fuite', 25000, 20, false, 'non', 14),
('majeur', '2.3',  'Coups et blessures', 22000, 15, true, 'attente', 15),
('majeur', '2.4',  'Mise en danger de la vie d''autrui', 22000, 15, true, 'attente', 16),
('majeur', '2.5',  'Vol / Arnaque', 18000, 15, true, 'oui', 17),
('majeur', '2.6',  'Altération, délabrement ou dégradation de bien collectif', 18000, 10, false, 'non', 18),
('majeur', '2.7',  'Usurpation d''identité ou de fonction', 18000, null, true, 'attente', 19),
('majeur', '2.8',  'Insubordination / refus d''obtempérer', 25000, 10, true, 'attente', 20),
('majeur', '2.9',  'Manque de respect envers un supérieur / un membre du HC', 17000, 25, true, 'attente', 21),
('majeur', '2.10', 'Outrepassement de ses fonctions', 18000, 15, true, 'attente', 22),
('majeur', '2.11', 'Prise de parole inappropriée dans l''enceinte du palais / tribunal / rang', 18000, null, true, 'attente', 23),
('majeur', '2.12', 'Harcèlement', 34000, 20, true, 'attente', 24),
('majeur', '2.13', 'Corruption', 20000, 20, true, 'attente', 25),
('majeur', '2.14', 'Possession de produit stupéfiant', 17000, 20, true, 'attente', 26),
('majeur', '2.15', 'Trafic de produit stupéfiant', 20000, 20, true, 'attente', 27),
('majeur', '2.16', 'Vente de produit stupéfiant', 20000, 20, true, 'attente', 28),
('majeur', '2.17', 'Menace et intimidation', 20000, 15, true, 'attente', 29),
('majeur', '2.18', 'Parjure', 22000, 15, true, 'attente', 30),
('majeur', '2.19', 'Non respect de la taxe hebdomadaire', 18000, 10, false, 'non', 31),
('majeur', '2.20', 'Outrage à magistrat', 17000, 15, false, 'oui', 32),
('majeur', '2.21', 'Jeux d''argent non déclarés', 18000, 10, true, 'attente', 33),
('majeur', '2.22', 'Évasion', 34000, 25, false, 'oui', 34),
-- ── Crimes ───────────────────────────────────────────────────────────
('crime', '3.1',  'Diffamation', 30000, null, true, 'oui', 35),
('crime', '3.2',  'Violences volontaires pour but de porter préjudice à une personne', 40000, null, true, 'oui', 36),
('crime', '3.3',  'Rébellion', 40000, null, true, 'oui', 37),
('crime', '3.4',  'Assassinat', 50000, null, true, 'oui', 38),
('crime', '3.5',  'Trahison', 50000, null, true, 'oui', 39),
('crime', '3.6',  'Homicide involontaire', 50000, null, true, 'oui', 40),
('crime', '3.7',  'Prise d''otage', 40000, null, true, 'oui', 41),
('crime', '3.8',  'Détournement de fonds publique', 50000, null, true, 'oui', 42),
('crime', '3.9',  'Faux ou usage de faux', 60000, null, true, 'oui', 43),
('crime', '3.10', 'Abus de biens sociaux', 30000, null, true, 'oui', 44),
('crime', '3.11', 'Enlèvement / séquestration', 50000, null, true, 'oui', 45),
('crime', '3.12', 'Torture', 50000, null, true, 'oui', 46);

insert into config (cle, valeur) values
('taux_recidive_1', '20'),
('taux_recidive_2', '40'),
('multiplicateur_aggravante', '2');
