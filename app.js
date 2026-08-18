// =====================================================================
// app.js — Kensatsu de Sunagakure (espace agent)
// Dépend de common.js (chargé avant ce fichier).
// =====================================================================

const SESSION_KEY = 'kensatsu_session';
const ZENKAI_API = 'https://db.builtbyloris.dev';

const RANK_ORDER = [
  'apprentis_genin', 'genin', 'genin confirme', 'chunin', 'chunin confirme',
  'tk-jonin', 'jonin', 'cmd', 'kage'
];
const RANK_LABELS = {
  'apprentis_genin': 'Apprentis genin', 'genin': 'Genin', 'genin confirme': 'Genin confirme',
  'chunin': 'Chunin', 'chunin confirme': 'Konin', 'tk-jonin': 'Tokubetsu-jonin',
  'jonin': 'Jonin', 'cmd': 'Commandant-jonin', 'kage': 'Kazekage'
};
function rankLabel(v) { return RANK_LABELS[v] || v || 'rang inconnu'; }

// --- Grades des agents de la kensatsu ---
const AGENT_ROLE_LABELS = {
  gardien_provisoire: 'Gardien provisoire',
  gardien_confirme: 'Gardien confirmé',
  sergent: 'Sergent',
  lieutenant: 'Lieutenant',
  capitaine: 'Capitaine',
  commandant: 'Commandant',
  co_gerant: 'Co-gérant',
  gerant: 'Gérant'
};
const ADMIN_ROLES = ['co_gerant', 'gerant'];

function hasSpecialisation(spec) {
  return !!(currentUser && Array.isArray(currentUser.specialisations) && currentUser.specialisations.includes(spec));
}

// ── Permissions configurables par grade (le gérant a toujours tout,
// ce qui n'est jamais modifiable, même si la table permissions dit
// le contraire ou est absente/inaccessible) ──
let currentPermissions = null;
const PERMISSION_DEFAULTS = {
  emettre_amende: true,
  marquer_paye: true,
  supprimer_infraction: false,
  acces_dossiers: false,
  acces_gerance: false,
  gerer_agents: false
};

async function loadPermissions() {
  if (!currentUser) return;
  if (currentUser.role === 'gerant') { currentPermissions = null; return; }
  try {
    const rows = await supaGet('permissions', `role=eq.${currentUser.role}`);
    if (rows.length === 0) throw new Error('table permissions vide/absente');
    const map = { ...PERMISSION_DEFAULTS };
    rows.forEach(r => { map[r.action] = r.allowed; });
    currentPermissions = map;
  } catch (e) {
    // La table n'existe pas encore (migration pas encore exécutée) : on
    // retombe sur l'ancien comportement figé (co-gérant = admin complet).
    console.error('Permissions indisponibles, repli sur les valeurs par défaut du rôle.', e);
    const fallback = { ...PERMISSION_DEFAULTS };
    if (ADMIN_ROLES.includes(currentUser.role)) {
      fallback.supprimer_infraction = true;
      fallback.acces_gerance = true;
      fallback.gerer_agents = true;
    }
    currentPermissions = fallback;
  }
}

function can(action) {
  if (currentUser && currentUser.role === 'gerant') return true;
  return !!(currentPermissions && currentPermissions[action]);
}

let currentUser = null;
let clockInterval = null;
let articlesCache = [];

const loginThrottle = makeLoginThrottle('kensatsu_login_throttle');

// --- Horaires de service (18h30 – 3h, identique à l'hôpital seimei) ---
function isServiceOpen() {
  const now = new Date();
  const totalMin = now.getHours() * 60 + now.getMinutes();
  // 18h30 (1110) à 3h00 (180) — traverse minuit
  return totalMin >= 1110 || totalMin < 180;
}

function updateClock() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const open = isServiceOpen();
  const statusCard = document.getElementById('server-status');
  const indicator = statusCard.querySelector('.status-indicator');
  const text = statusCard.querySelector('span:last-child');

  if (open) {
    indicator.className = 'status-indicator online';
    text.textContent = 'La kensatsu est ouverte — Service actif';
  } else {
    indicator.className = 'status-indicator offline';
    text.textContent = 'Le village est endormi — Hors horaires de service';
  }

  const btnService = document.getElementById('btn-service');
  if (open && currentUser) {
    btnService.disabled = false;
  } else {
    if (!enPoste) btnService.disabled = true;
    if (enPoste && !open) quitterPoste();
  }
}

// --- Auth : onglets ---
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.getElementById('login-form').classList.toggle('hidden', target !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', target !== 'register');
  });
});

// --- Enregistrement ---
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const nom = document.getElementById('reg-nom').value.trim();
  const prenom = document.getElementById('reg-prenom').value.trim();
  const sceau = document.getElementById('reg-sceau').value;
  const sceau2 = document.getElementById('reg-sceau2').value;
  const errEl = document.getElementById('reg-error');
  const sucEl = document.getElementById('reg-success');
  errEl.textContent = '';
  sucEl.textContent = '';

  if (!nom || !prenom) { errEl.textContent = 'Merci de renseigner ton nom et ton prénom.'; return; }
  if (sceau !== sceau2) { errEl.textContent = 'Les sceaux ne correspondent pas.'; return; }
  if (sceau.length < 6) { errEl.textContent = 'Le sceau doit contenir au moins 6 caractères.'; return; }

  submitBtn.disabled = true;
  try {
    const existing = await supaGet('agents', `nom=eq.${encodeURIComponent(nom)}&prenom=eq.${encodeURIComponent(prenom)}&select=id`);
    if (existing.length > 0) { errEl.textContent = 'Cet agent est déjà enregistré.'; return; }

    const hashed = await hashSceau(sceau);
    await supaPost('agents', { nom, prenom, sceau: hashed, role: 'gardien_provisoire' }, true);
    sucEl.textContent = 'Enregistrement réussi ! Vous pouvez maintenant vous identifier.';
    document.getElementById('register-form').reset();
  } catch (err) {
    errEl.textContent = 'Erreur de connexion au registre. Réessaie dans un instant.';
    console.error(err);
  } finally {
    submitBtn.disabled = false;
  }
});

// --- Connexion ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  if (loginThrottle.isLocked()) {
    errEl.textContent = `Trop de tentatives. Réessaie dans ${loginThrottle.remainingSeconds()} s.`;
    return;
  }

  const nom = document.getElementById('login-nom').value.trim();
  const prenom = document.getElementById('login-prenom').value.trim();
  const sceau = document.getElementById('login-sceau').value;

  submitBtn.disabled = true;
  try {
    const hashed = await hashSceau(sceau);
    const users = await supaRpc('verifier_sceau_agent', { p_nom: nom, p_prenom: prenom, p_sceau_hash: hashed });
    if (users.length === 0) {
      loginThrottle.registerFailure();
      errEl.textContent = 'Identité ou sceau incorrect.';
      return;
    }
    if (users[0].actif === false) {
      errEl.textContent = 'Ce compte a été désactivé par la gérance.';
      return;
    }

    loginThrottle.registerSuccess();
    currentUser = users[0];
    saveSession(SESSION_KEY, currentUser);
    showDashboard();
  } catch (err) {
    errEl.textContent = 'Erreur de connexion au registre.';
    console.error(err);
  } finally {
    submitBtn.disabled = false;
  }
});

async function showDashboard() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('hidden');
  document.getElementById('user-name').textContent = `${currentUser.prenom} ${currentUser.nom}`;
  const roleBadge = document.getElementById('user-role');
  roleBadge.textContent = AGENT_ROLE_LABELS[currentUser.role] || currentUser.role;
  roleBadge.className = 'role-badge ' + currentUser.role;
  await loadPermissions();
  document.getElementById('gerance-link').style.display = can('acces_gerance') ? 'inline-flex' : 'none';
  document.getElementById('dossiers-nav').style.display = (hasSpecialisation('enquete') || can('acces_dossiers')) ? 'inline-flex' : 'none';
  updateClock();
  clockInterval = setInterval(updateClock, 1000);
  showGroup('service');
  checkExistingPoste();
  loadServiceList();
  loadNinjaFilters();
  loadArticlesCache();
  loadHistorique();
}

// --- Navigation sidebar (groupes) ---
function showGroup(name) {
  document.querySelectorAll('.group-panel').forEach(p => p.classList.toggle('active', p.dataset.group === name));
  document.querySelectorAll('.snav').forEach(b => b.classList.toggle('active', b.dataset.group === name));
  if (name === 'code-penal') renderCodePenalTables();
  if (name === 'historique') loadHistorique();
  if (name === 'registre') loadRegistreCasiers();
  if (name === 'dossiers') loadDossiers();
  if (name === 'service') loadServiceList();
  if (name === 'plaintes') loadPlaintes();
}
document.querySelectorAll('.snav').forEach(b => {
  b.addEventListener('click', () => showGroup(b.dataset.group));
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  if (enPoste) await quitterPoste();
  currentUser = null;
  clearSession(SESSION_KEY);
  clearInterval(clockInterval);
  document.getElementById('dashboard-screen').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('login-form').reset();
});

// ── Prise de service ──
let enPoste = false;
let posteId = null;

// Heure de fermeture (3h00) la plus récente déjà passée — sert à purger
// automatiquement les services que personne n'a quittés manuellement.
function serviceCutoffISO() {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setHours(3, 0, 0, 0);
  if (now < cutoff) cutoff.setDate(cutoff.getDate() - 1);
  return cutoff.toISOString();
}

async function sweepStaleServices() {
  try {
    const cutoff = serviceCutoffISO();
    await supaPatch('postes', `actif=eq.true&debut=lt.${cutoff}`, { actif: false, fin: cutoff }, true);
  } catch (e) { console.error(e); }
}

async function checkExistingPoste() {
  await sweepStaleServices();
  try {
    const rows = await supaGet('postes', `agent_id=eq.${currentUser.id}&actif=eq.true`);
    if (rows.length > 0) {
      enPoste = true;
      posteId = rows[0].id;
    } else {
      enPoste = false;
      posteId = null;
    }
    updatePosteUI();
  } catch (e) { console.error(e); }
}

function updatePosteUI() {
  const btn = document.getElementById('btn-service');
  const badge = document.getElementById('service-badge');
  if (enPoste) {
    btn.textContent = 'Quitter son service';
    btn.classList.add('en-poste');
    badge.textContent = 'En service';
    badge.classList.add('actif');
  } else {
    btn.textContent = 'Prendre son service';
    btn.classList.remove('en-poste');
    badge.textContent = 'Hors service';
    badge.classList.remove('actif');
  }
}

document.getElementById('btn-service').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    if (enPoste) await quitterPoste();
    else await prendrePoste();
  } finally {
    updateClock(); // remet l'état disabled correct selon les horaires
  }
});

async function prendrePoste() {
  if (!isServiceOpen()) return;
  try {
    const result = await supaPost('postes', { agent_id: currentUser.id, debut: new Date().toISOString(), actif: true });
    posteId = result[0].id;
    enPoste = true;
    updatePosteUI();
    loadServiceList();
  } catch (e) { console.error(e); }
}

async function quitterPoste() {
  if (!posteId) return;
  try {
    await supaPatch('postes', `id=eq.${posteId}`, { actif: false, fin: new Date().toISOString() }, true);
    enPoste = false;
    posteId = null;
    updatePosteUI();
    loadServiceList();
  } catch (e) { console.error(e); }
}

async function loadServiceList() {
  const ul = document.getElementById('service-list');
  if (!ul) return;
  ul.innerHTML = '<li class="list-empty">Chargement...</li>';
  await sweepStaleServices();
  try {
    const rows = await supaGet('postes', 'actif=eq.true&select=id,debut,agents!postes_agent_id_fkey(nom,prenom)&order=debut.asc');
    ul.innerHTML = '';
    if (rows.length === 0) {
      ul.innerHTML = '<li class="list-empty">Aucun agent en service actuellement</li>';
      return;
    }
    rows.forEach(p => {
      const li = document.createElement('li');
      const heure = new Date(p.debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const nom = p.agents ? `${p.agents.prenom} ${p.agents.nom}` : 'agent supprimé';
      li.textContent = `${nom} — en service depuis ${heure}`;
      ul.appendChild(li);
    });
  } catch (e) {
    console.error(e);
    ul.innerHTML = '<li class="list-empty">Erreur de chargement</li>';
  }
}

// ── Plaintes ──
const PLAINTE_STATUT_LABELS = { nouvelle: 'Nouvelle', en_cours: 'En cours', traitee: 'Traitée', classee: 'Classée' };

// --- Recherche de ninja réutilisable (plaignant / accusé) ---
function wireNinjaPicker(inputId, resultsId, onSelect) {
  let timer = null;
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { results.classList.add('hidden'); results.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const res = await fetch(`${ZENKAI_API}/api/characters?sort=name&order=asc&limit=15&search=${encodeURIComponent(q)}`);
        const body = await res.json();
        const chars = body.data || [];
        results.innerHTML = '';
        if (chars.length === 0) {
          results.innerHTML = '<li class="search-result-empty">Aucun ninja trouvé</li>';
        } else {
          chars.forEach(c => {
            const d = (c.divisions && c.divisions[0]) || null;
            const meta = `${rankLabel(c.rank)}${d ? ' · ' + d.type : ''}`;
            const li = document.createElement('li');
            li.className = 'search-result';
            li.innerHTML = `<strong>${escapeHtml(c.name)}</strong> <span class="infraction-meta">${escapeHtml(meta)}</span>`;
            li.addEventListener('click', () => {
              onSelect(c);
              results.classList.add('hidden');
            });
            results.appendChild(li);
          });
        }
        results.classList.remove('hidden');
      } catch (e) { console.error(e); }
    }, 300);
  });
}

let plaignantSelectionne = null;
let accusesSelectionnes = [];

wireNinjaPicker('plainte-plaignant-search', 'plainte-plaignant-results', (c) => {
  plaignantSelectionne = c;
  document.getElementById('plainte-plaignant-search').value = c.name;
  const grade = document.getElementById('plainte-plaignant-grade');
  grade.classList.remove('hidden');
  grade.innerHTML = `<div class="ap-row"><span class="ap-label">Grade</span><strong>${escapeHtml(rankLabel(c.rank))}</strong></div>`;
});
wireNinjaPicker('plainte-accuse-search', 'plainte-accuse-results', (c) => {
  if (!accusesSelectionnes.find(a => a.charKey === c.charKey)) {
    accusesSelectionnes.push({ nom: c.name, charKey: c.charKey, grade: rankLabel(c.rank) });
    renderAccusesSelectionnes();
  }
  document.getElementById('plainte-accuse-search').value = '';
});

function renderAccusesSelectionnes() {
  const wrap = document.getElementById('plainte-accuses-selected');
  wrap.innerHTML = accusesSelectionnes.map((a, i) =>
    `<span class="tag tag-recidive2 plainte-accuse-chip" data-i="${i}" title="Cliquer pour retirer">${escapeHtml(a.nom)} (${escapeHtml(a.grade)}) ✕</span>`
  ).join('');
  wrap.querySelectorAll('.plainte-accuse-chip').forEach(el => {
    el.addEventListener('click', () => {
      accusesSelectionnes.splice(Number(el.dataset.i), 1);
      renderAccusesSelectionnes();
    });
  });
}

// --- Faits reprochés (choix multiple d'articles) ---
let plainteArticlesSelectionnes = [];

document.getElementById('plainte-articles-search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  const results = document.getElementById('plainte-articles-results');
  if (!q) { results.classList.add('hidden'); results.innerHTML = ''; return; }
  const matches = articlesCache.filter(a =>
    a.code.toLowerCase().includes(q) || a.libelle.toLowerCase().includes(q)
  ).slice(0, 15);
  results.innerHTML = '';
  if (matches.length === 0) {
    results.innerHTML = '<li class="search-result-empty">Aucun article trouvé</li>';
  } else {
    matches.forEach(a => {
      const li = document.createElement('li');
      li.className = 'search-result';
      li.innerHTML = `<strong>${escapeHtml(a.code)}</strong> — ${escapeHtml(a.libelle)}`;
      li.addEventListener('click', () => {
        if (!plainteArticlesSelectionnes.find(x => x.id === a.id)) {
          plainteArticlesSelectionnes.push(a);
          renderPlainteArticlesSelectionnes();
        }
        document.getElementById('plainte-articles-search').value = '';
        results.classList.add('hidden');
      });
      results.appendChild(li);
    });
  }
  results.classList.remove('hidden');
});

function renderPlainteArticlesSelectionnes() {
  const wrap = document.getElementById('plainte-articles-selected');
  wrap.innerHTML = plainteArticlesSelectionnes.map(a =>
    `<span class="tag tag-recidive1 plainte-article-chip" data-id="${a.id}" title="Cliquer pour retirer">${escapeHtml(a.code)} ✕</span>`
  ).join('');
  wrap.querySelectorAll('.plainte-article-chip').forEach(el => {
    el.addEventListener('click', () => {
      plainteArticlesSelectionnes = plainteArticlesSelectionnes.filter(a => a.id !== el.dataset.id);
      renderPlainteArticlesSelectionnes();
    });
  });
}

// --- Photo jointe ---
let plaintePhotoDataUrl = null;

document.getElementById('plainte-photo-wrap').addEventListener('click', () => {
  document.getElementById('photo-file-input').click();
});

function resetPlainteForm() {
  document.getElementById('plainte-form').reset();
  plaignantSelectionne = null;
  accusesSelectionnes = [];
  plainteArticlesSelectionnes = [];
  plaintePhotoDataUrl = null;
  document.getElementById('plainte-plaignant-grade').classList.add('hidden');
  document.getElementById('plainte-accuses-selected').innerHTML = '';
  document.getElementById('plainte-articles-results').classList.add('hidden');
  document.getElementById('plainte-articles-selected').innerHTML = '';
  document.getElementById('plainte-photo-img').classList.add('hidden');
  document.getElementById('plainte-photo-hint').classList.remove('hidden');
  document.getElementById('plainte-photo-hint').textContent = 'Cliquer ou coller (Ctrl+V)';
}

document.getElementById('plainte-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('plainte-status');
  statusEl.textContent = '';
  const plaignantNom = document.getElementById('plainte-plaignant-search').value.trim();
  const motif = document.getElementById('plainte-motif').value.trim();
  if (!plaignantNom || !motif) return;
  const moment = document.getElementById('plainte-moment').value;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    await supaPost('plaintes', {
      plaignant_nom: plaignantNom,
      plaignant_char_key: plaignantSelectionne ? plaignantSelectionne.charKey : null,
      plaignant_grade: plaignantSelectionne ? rankLabel(plaignantSelectionne.rank) : null,
      mis_en_cause_nom: accusesSelectionnes.length ? accusesSelectionnes.map(a => a.nom).join(', ') : null,
      accuses: accusesSelectionnes,
      moment_faits: moment ? new Date(moment).toISOString() : null,
      article_ids: plainteArticlesSelectionnes.map(a => a.id),
      motif,
      photo_data: plaintePhotoDataUrl,
      created_by: currentUser.id
    }, true);
    resetPlainteForm();
    loadPlaintes();
  } catch (err) {
    statusEl.textContent = "Erreur lors de l'enregistrement.";
    console.error(err);
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('plainte-statut-filtre').addEventListener('change', () => loadPlaintes());

let plaintesCache = [];
let openPlainteId = null;

async function loadPlaintes() {
  const ul = document.getElementById('plaintes-list');
  if (!ul) return;
  ul.innerHTML = '<li class="list-empty">Chargement...</li>';
  try {
    const statut = document.getElementById('plainte-statut-filtre').value;
    let query = 'select=*,agents(nom,prenom)&order=created_at.desc';
    if (statut) query += `&statut=eq.${statut}`;
    const rows = await supaGet('plaintes', query);
    plaintesCache = rows;
    ul.innerHTML = '';
    if (rows.length === 0) {
      ul.innerHTML = '<li class="list-empty">Aucune plainte enregistrée</li>';
      return;
    }
    rows.forEach(p => {
      const li = document.createElement('li');
      const date = new Date(p.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const titre = p.plaignant_nom + (p.mis_en_cause_nom ? ' contre ' + p.mis_en_cause_nom : '');
      li.className = 'dossier-folder';
      li.innerHTML = `
        <span class="dossier-folder-ico"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l3 3v15H6Z"/><path d="M15 3v3h3"/><path d="M9 12h6M9 15.5h6M9 8.5h3"/></svg></span>
        <div class="dossier-folder-info">
          <div class="infraction-titre">${escapeHtml(titre)}</div>
          <div class="infraction-meta">${date}</div>
        </div>
        <span class="statut-pill statut-${p.statut}"><span class="statut-dot"></span>${PLAINTE_STATUT_LABELS[p.statut]}</span>`;
      li.addEventListener('click', () => openPlainteModal(p.id));
      ul.appendChild(li);
    });
  } catch (e) {
    console.error(e);
    ul.innerHTML = '<li class="list-empty">Erreur de chargement des plaintes</li>';
  }
}

function openPlainteModal(id) {
  const p = plaintesCache.find(x => x.id === id);
  if (!p) return;
  openPlainteId = id;
  const date = new Date(p.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const auteur = p.agents ? `${p.agents.prenom} ${p.agents.nom}` : 'agent supprimé';
  const momentTxt = p.moment_faits
    ? new Date(p.moment_faits).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'non renseigné';

  document.getElementById('plainte-modal-titre').textContent = p.plaignant_nom + (p.mis_en_cause_nom ? ' contre ' + p.mis_en_cause_nom : '');
  document.getElementById('plainte-modal-meta').textContent = `Reçue le ${date} par ${auteur} · faits du ${momentTxt}`;
  document.getElementById('plainte-modal-statut').value = p.statut;
  document.getElementById('plainte-modal-statut').className = 'statut-select statut-select-' + p.statut;
  document.getElementById('plainte-modal-plaignant').textContent = p.plaignant_nom + (p.plaignant_grade ? ` (${p.plaignant_grade})` : '');
  if (Array.isArray(p.accuses) && p.accuses.length > 0) {
    document.getElementById('plainte-modal-accuse').textContent = p.accuses.map(a => `${a.nom} (${a.grade})`).join(', ');
  } else {
    document.getElementById('plainte-modal-accuse').textContent = p.mis_en_cause_nom
      ? p.mis_en_cause_nom + (p.accuse_grade ? ` (${p.accuse_grade})` : '')
      : 'Non renseigné';
  }
  document.getElementById('plainte-modal-motif').textContent = p.motif;

  const articlesLabels = (p.article_ids || [])
    .map(aid => articlesCache.find(a => a.id === aid))
    .filter(Boolean)
    .map(a => `<span class="tag tag-impaye">${escapeHtml(a.code)} — ${escapeHtml(a.libelle)}</span>`).join('');
  document.getElementById('plainte-modal-articles').innerHTML = articlesLabels || '<span class="infraction-meta">Aucun article renseigné</span>';

  const photoWrap = document.getElementById('plainte-modal-photo-wrap');
  if (p.photo_data) {
    photoWrap.innerHTML = `<h4>Photo</h4><img src="${p.photo_data}" class="dossier-photo-thumb plainte-photo-view" style="width:110px;height:90px;cursor:zoom-in;">`;
    photoWrap.querySelector('.plainte-photo-view').addEventListener('click', () => {
      document.getElementById('photo-zoom-img').src = p.photo_data;
      document.getElementById('photo-zoom-overlay').classList.remove('hidden');
    });
  } else {
    photoWrap.innerHTML = '';
  }

  document.getElementById('plainte-delete-btn').style.display = can('supprimer_infraction') ? 'inline-block' : 'none';
  document.getElementById('plainte-modal-overlay').classList.remove('hidden');
}

document.getElementById('plainte-modal-close').addEventListener('click', () => {
  document.getElementById('plainte-modal-overlay').classList.add('hidden');
  openPlainteId = null;
});

document.getElementById('plainte-modal-statut').addEventListener('change', async (e) => {
  if (!openPlainteId) return;
  e.target.className = 'statut-select statut-select-' + e.target.value;
  try {
    await supaPatch('plaintes', `id=eq.${openPlainteId}`, { statut: e.target.value, updated_at: new Date().toISOString() }, true);
    loadPlaintes();
  } catch (err) { console.error(err); }
});

document.getElementById('plainte-delete-btn').addEventListener('click', async () => {
  if (!openPlainteId) return;
  if (!confirm('Supprimer définitivement cette plainte ?')) return;
  try {
    await supaDelete('plaintes', `id=eq.${openPlainteId}`);
    document.getElementById('plainte-modal-overlay').classList.add('hidden');
    openPlainteId = null;
    loadPlaintes();
  } catch (err) { console.error(err); }
});

// --- Restauration de session ---
(function restoreSession() {
  const saved = loadSession(SESSION_KEY);
  if (saved) { currentUser = saved; showDashboard(); }
})();

// ── Recherche de ninjas (API Zenkai) ──
let selectedNinjaKey = null;
let selectedNinjaNom = '';
let ninjaSearchTimer = null;
let browseChars = [];
let browsePage = 0;
let browsePages = 1;
let browseTotal = 0;
let browseLoading = false;
let browseSeq = 0;

async function loadNinjaFilters() {
  try {
    const res = await fetch(`${ZENKAI_API}/api/filters`);
    if (!res.ok) throw new Error('Réponse API invalide');
    const body = await res.json();
    const d = body.data || {};
    const rankSel = document.getElementById('filter-rank');
    const divSel = document.getElementById('filter-division');
    const counts = {};
    (d.ranks || []).forEach(r => { counts[r.value] = r.count; });
    const known = RANK_ORDER.filter(v => counts[v] != null);
    const extras = (d.ranks || []).map(r => r.value).filter(v => RANK_ORDER.indexOf(v) === -1);
    known.concat(extras).forEach(v => {
      rankSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(v)}">${escapeHtml(rankLabel(v))} (${counts[v]})</option>`);
    });
    (d.divisions || []).forEach(v => {
      divSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(v.value)}">${escapeHtml(v.value)} (${v.count})</option>`);
    });
  } catch (e) { console.error('Filtres Zenkai indisponibles:', e); }
}

async function loadBrowsePage(reset) {
  if (!reset) {
    if (browseLoading) return;
    if (browsePage > 0 && browsePage >= browsePages) return;
  }
  if (reset) { browseChars = []; browsePage = 0; browsePages = 1; browseTotal = 0; }
  const seq = ++browseSeq;
  browseLoading = true;
  try {
    const q = document.getElementById('ninja-search').value.trim();
    const rank = document.getElementById('filter-rank').value;
    const division = document.getElementById('filter-division').value;
    let url = `${ZENKAI_API}/api/characters?sort=name&order=asc&limit=50&page=${browsePage + 1}`;
    if (q.length >= 2) url += `&search=${encodeURIComponent(q)}`;
    if (rank) url += `&rank=${encodeURIComponent(rank)}`;
    if (division) url += `&division=${encodeURIComponent(division)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Réponse API invalide');
    const body = await res.json();
    if (seq !== browseSeq) return;
    browsePage = body.page;
    browsePages = body.pages;
    browseTotal = body.total;
    browseChars = browseChars.concat(body.data || []);
    renderNinjaResults(browseChars, true);
  } catch (e) {
    if (seq !== browseSeq) return;
    console.error(e);
    document.getElementById('ninja-results').innerHTML = '<li class="search-result-empty">API Zenkai injoignable</li>';
  } finally {
    if (seq === browseSeq) browseLoading = false;
  }
}

document.querySelectorAll('.snav[data-group="casiers"]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (browsePage === 0 && browseChars.length === 0) loadBrowsePage(true);
  });
});

document.getElementById('ninja-search').addEventListener('input', () => {
  clearTimeout(ninjaSearchTimer);
  ninjaSearchTimer = setTimeout(() => loadBrowsePage(true), 300);
});
document.getElementById('filter-rank').addEventListener('change', () => loadBrowsePage(true));
document.getElementById('filter-division').addEventListener('change', () => loadBrowsePage(true));

function renderNinjaResults(chars, isBrowse) {
  const ul = document.getElementById('ninja-results');
  ul.innerHTML = '';
  if (chars.length === 0) {
    ul.innerHTML = '<li class="search-result-empty">Aucun ninja trouvé</li>';
    return;
  }
  chars.forEach(c => {
    const d = (c.divisions && c.divisions[0]) || null;
    const meta = `${rankLabel(c.rank)}${d ? ' · ' + d.type + (d.grade ? ' (' + d.grade + ')' : '') : ''}`;
    const li = document.createElement('li');
    li.className = 'search-result';
    li.innerHTML = `<strong>${escapeHtml(c.name)}</strong> <span class="infraction-meta">${escapeHtml(meta)}</span>`;
    li.addEventListener('click', () => openCasier(c.charKey, c.name, meta));
    ul.appendChild(li);
  });
  if (isBrowse && browsePage < browsePages) {
    const li = document.createElement('li');
    li.className = 'search-result search-load-more';
    li.textContent = 'Charger plus (' + (browseTotal - browseChars.length) + ' ninjas restants)';
    li.addEventListener('click', () => loadBrowsePage());
    ul.appendChild(li);
  }
}

// ── Registre des casiers déjà enregistrés ──
let registreCache = null;

document.getElementById('registre-search').addEventListener('input', () => renderRegistre());
document.getElementById('registre-statut').addEventListener('change', () => renderRegistre());
document.getElementById('registre-tri').addEventListener('change', () => renderRegistre());

async function loadRegistreCasiers() {
  const ul = document.getElementById('registre-list');
  ul.innerHTML = '<li class="list-empty">Chargement...</li>';
  try {
    const rows = await supaGet('infractions', 'select=ninja_char_key,ninja_nom,montant,paye,created_at&order=created_at.desc&limit=1000');
    const map = {};
    rows.forEach(r => {
      if (!map[r.ninja_char_key]) map[r.ninja_char_key] = { nom: r.ninja_nom, count: 0, impaye: 0, totalPaye: true, derniere: r.created_at };
      map[r.ninja_char_key].count += 1;
      if (!r.paye) { map[r.ninja_char_key].impaye += r.montant; map[r.ninja_char_key].totalPaye = false; }
    });
    registreCache = Object.entries(map).map(([key, info]) => ({ key, ...info }));
    renderRegistre();
  } catch (e) {
    console.error(e);
    ul.innerHTML = '<li class="list-empty">Erreur de chargement du registre</li>';
  }
}

function renderRegistre() {
  const ul = document.getElementById('registre-list');
  if (!registreCache) return;
  const search = document.getElementById('registre-search').value.trim().toLowerCase();
  const statut = document.getElementById('registre-statut').value;
  const tri = document.getElementById('registre-tri').value;

  let list = registreCache.slice();
  if (search) list = list.filter(info => info.nom.toLowerCase().includes(search));
  if (statut === 'impaye') list = list.filter(info => info.impaye > 0);
  if (statut === 'paye') list = list.filter(info => info.totalPaye);

  if (tri === 'montant') list.sort((a, b) => b.impaye - a.impaye);
  else if (tri === 'count') list.sort((a, b) => b.count - a.count);
  else list.sort((a, b) => new Date(b.derniere) - new Date(a.derniere));

  ul.innerHTML = '';
  if (list.length === 0) {
    ul.innerHTML = '<li class="list-empty">Aucun casier ne correspond à ces filtres</li>';
    return;
  }
  list.forEach(info => {
    const li = document.createElement('li');
    const date = new Date(info.derniere).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    li.className = 'search-result';
    li.innerHTML = `<strong>${escapeHtml(info.nom)}</strong> <span class="infraction-meta">${info.count} infraction${info.count > 1 ? 's' : ''} · dernière le ${date}${info.impaye > 0 ? ' · <span class="tag tag-impaye">' + formatRyos(info.impaye) + ' impayé</span>' : ' · <span class="tag tag-paye">Tout payé</span>'}</span>`;
    li.addEventListener('click', () => openCasier(info.key, info.nom, `${info.count} infraction${info.count > 1 ? 's' : ''} au casier`));
    ul.appendChild(li);
  });
}

// ── Casier judiciaire (modal) ──
async function openCasier(key, nom, meta) {
  selectedNinjaKey = key;
  selectedNinjaNom = nom;
  document.getElementById('casier-nom').textContent = nom;
  document.getElementById('casier-meta').textContent = meta || '';
  document.getElementById('infraction-form').reset();
  selectedArticleId = null;
  document.getElementById('inf-article-results').classList.add('hidden');
  document.getElementById('inf-article').disabled = true;
  document.getElementById('article-preview').classList.add('hidden');
  document.getElementById('recidive-alert').classList.add('hidden');
  document.getElementById('montant-total').classList.add('hidden');
  document.getElementById('infraction-status').textContent = '';
  document.getElementById('casier-modal-overlay').classList.remove('hidden');
  await Promise.all([loadInfractionsList(), loadCasierPhoto()]);
}

document.getElementById('casier-modal-close').addEventListener('click', () => {
  document.getElementById('casier-modal-overlay').classList.add('hidden');
});

// ── Zoom sur la photo ──
document.getElementById('casier-photo-img').addEventListener('click', (e) => {
  if (!e.target.src) return;
  document.getElementById('photo-zoom-img').src = e.target.src;
  document.getElementById('photo-zoom-overlay').classList.remove('hidden');
});
document.getElementById('photo-zoom-overlay').addEventListener('click', () => {
  document.getElementById('photo-zoom-overlay').classList.add('hidden');
});

// ── Photo de la fiche (collée au Ctrl+V) ──
async function loadCasierPhoto() {
  const img = document.getElementById('casier-photo-img');
  const hint = document.getElementById('casier-photo-hint');
  img.classList.add('hidden');
  hint.classList.remove('hidden');
  hint.textContent = 'Colle une image (Ctrl+V)';
  try {
    const rows = await supaGet('casier_photos', `ninja_char_key=eq.${encodeURIComponent(selectedNinjaKey)}&select=photo_data`);
    if (rows.length > 0) {
      img.src = rows[0].photo_data;
      img.classList.remove('hidden');
      hint.classList.add('hidden');
    }
  } catch (e) { console.error(e); }
}

function resizeImageToDataUrl(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const ratio = Math.min(maxSize / width, maxSize / height, 1);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Réception d'une image (par Ctrl+V ou par le sélecteur de fichier) ──
async function handleIncomingImageFile(file) {
  const overlay = document.getElementById('casier-modal-overlay');
  if (overlay && !overlay.classList.contains('hidden') && selectedNinjaKey) {
    const hint = document.getElementById('casier-photo-hint');
    hint.classList.remove('hidden');
    hint.textContent = 'Enregistrement...';
    try {
      const dataUrl = await resizeImageToDataUrl(file, 500);
      await supaUpsert('casier_photos', {
        ninja_char_key: selectedNinjaKey,
        photo_data: dataUrl,
        updated_by: currentUser.id,
        updated_at: new Date().toISOString()
      }, '?on_conflict=ninja_char_key');
      const img = document.getElementById('casier-photo-img');
      img.src = dataUrl;
      img.classList.remove('hidden');
      hint.classList.add('hidden');
    } catch (err) {
      console.error(err);
      hint.textContent = "Erreur, réessaie.";
    }
    return true;
  }

  const dossierOverlay = document.getElementById('dossier-modal-overlay');
  if (dossierOverlay && !dossierOverlay.classList.contains('hidden') && openDossierId) {
    const zone = document.getElementById('dossier-photo-add-zone');
    if (zone) zone.textContent = '...';
    try {
      const dataUrl = await resizeImageToDataUrl(file, 500);
      await supaPost('dossier_photos', { dossier_id: openDossierId, photo_data: dataUrl }, true);
      loadDossierGallery(openDossierId);
    } catch (err) {
      console.error(err);
      if (zone) zone.textContent = 'Erreur';
    }
    return true;
  }

  const plaintesPanel = document.querySelector('.group-panel[data-group="plaintes"]');
  if (plaintesPanel && plaintesPanel.classList.contains('active')) {
    const hint = document.getElementById('plainte-photo-hint');
    hint.classList.remove('hidden');
    hint.textContent = 'Chargement...';
    try {
      plaintePhotoDataUrl = await resizeImageToDataUrl(file, 500);
      const img = document.getElementById('plainte-photo-img');
      img.src = plaintePhotoDataUrl;
      img.classList.remove('hidden');
      hint.classList.add('hidden');
    } catch (err) {
      console.error(err);
      hint.textContent = 'Erreur, réessaie.';
    }
    return true;
  }
  return false;
}

window.addEventListener('paste', async (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  let file = null;
  for (const item of items) {
    if (item.type.startsWith('image/')) { file = item.getAsFile(); break; }
  }
  if (!file) return;
  const handled = await handleIncomingImageFile(file);
  if (handled) e.preventDefault();
});

document.getElementById('casier-photo-wrap').addEventListener('click', () => {
  const img = document.getElementById('casier-photo-img');
  if (!img.classList.contains('hidden')) return; // clic sur l'image = zoom (géré ailleurs)
  document.getElementById('photo-file-input').click();
});

document.getElementById('photo-file-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) await handleIncomingImageFile(file);
});

async function loadInfractionsList() {
  const ul = document.getElementById('infractions-list');
  ul.innerHTML = '<li class="list-empty">Chargement...</li>';
  try {
    const rows = await supaGet('infractions',
      `ninja_char_key=eq.${encodeURIComponent(selectedNinjaKey)}&select=*,articles_code_penal(code,libelle,categorie)&order=created_at.desc`);
    ul.innerHTML = '';
    if (rows.length === 0) {
      ul.innerHTML = '<li class="list-empty">Casier vierge — aucune infraction enregistrée</li>';
      return;
    }
    rows.forEach(r => ul.appendChild(renderInfractionItem(r)));
  } catch (e) {
    console.error(e);
    ul.innerHTML = '<li class="list-empty">Erreur de chargement du casier</li>';
  }
}

function renderInfractionItem(r) {
  const art = r.articles_code_penal || {};
  const li = document.createElement('li');
  const date = new Date(r.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  let badges = '';
  if (r.recidive_niveau === 1) badges += '<span class="tag tag-recidive1">1ère récidive +20%</span>';
  if (r.recidive_niveau === 2) badges += '<span class="tag tag-recidive2">2e récidive +40%</span>';
  if (r.circonstance_aggravante) badges += '<span class="tag tag-aggravante">Aggravante ×2</span>';
  badges += r.paye ? '<span class="tag tag-paye">Payé</span>' : '<span class="tag tag-impaye">Impayé</span>';
  li.innerHTML = `
    <div class="infraction-item">
      <div class="infraction-left">
        <div class="infraction-titre">${escapeHtml(art.code || '')} — ${escapeHtml(art.libelle || '')}</div>
        <div class="infraction-meta">${date} ${r.cellule_minutes ? '· ' + r.cellule_minutes + ' min de cellule' : ''} · Comparution ${boolBadge(r.comparution)} · Jugement ${jugementBadge(r.jugement)}</div>
        <div class="infraction-badges">${badges}</div>
        ${r.commentaire ? `<div class="infraction-meta">"${escapeHtml(r.commentaire)}"</div>` : ''}
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div class="infraction-montant">${formatRyos(r.montant)}</div>
        <button class="btn-toggle-paye ${r.paye ? '' : 'impaye'}" data-id="${r.id}" data-paye="${r.paye}">${r.paye ? 'Marquer impayé' : 'Marquer payé'}</button>
        ${can('supprimer_infraction') ? `<button class="btn-delete-inf" data-id="${r.id}" title="Supprimer cette infraction">Supprimer</button>` : ''}
      </div>
    </div>`;
  li.querySelector('.btn-toggle-paye').addEventListener('click', async (ev) => {
    const btn = ev.target;
    const id = btn.dataset.id;
    const nowPaye = btn.dataset.paye === 'true';
    try {
      await supaPatch('infractions', `id=eq.${id}`, { paye: !nowPaye, paid_at: !nowPaye ? new Date().toISOString() : null }, true);
      await loadInfractionsList();
      loadHistorique();
    } catch (e) { console.error(e); }
  });
  const delBtn = li.querySelector('.btn-delete-inf');
  if (delBtn) {
    delBtn.addEventListener('click', async (ev) => {
      const id = ev.target.dataset.id;
      if (!confirm('Supprimer définitivement cette infraction du casier ?')) return;
      try {
        await supaDelete('infractions', `id=eq.${id}`);
        await loadInfractionsList();
        loadHistorique();
        loadRegistreCasiers();
      } catch (e) { console.error(e); }
    });
  }
  return li;
}

// ── Formulaire d'ajout d'infraction ──
async function loadArticlesCache() {
  try {
    articlesCache = await supaGet('articles_code_penal', 'select=*&order=ordre.asc');
  } catch (e) { console.error(e); }
}

let selectedArticleId = null;
const CAT_LABELS_SHORT = { mineur: 'Mineur', majeur: 'Majeur', crime: 'Crime' };

document.getElementById('inf-article-search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  selectedArticleId = null;
  document.getElementById('article-preview').classList.add('hidden');
  document.getElementById('recidive-alert').classList.add('hidden');
  document.getElementById('montant-total').classList.add('hidden');
  const results = document.getElementById('inf-article-results');
  if (!q) { results.classList.add('hidden'); results.innerHTML = ''; return; }
  const matches = articlesCache.filter(a =>
    a.code.toLowerCase().includes(q) || a.libelle.toLowerCase().includes(q)
  ).slice(0, 20);
  results.innerHTML = '';
  if (matches.length === 0) {
    results.innerHTML = '<li class="search-result-empty">Aucun article trouvé</li>';
  } else {
    matches.forEach(a => {
      const li = document.createElement('li');
      li.className = 'search-result';
      li.innerHTML = `<strong>${escapeHtml(a.code)}</strong> [${CAT_LABELS_SHORT[a.categorie] || a.categorie}] — ${escapeHtml(a.libelle)} <span class="infraction-meta">${formatRyos(a.amende)}</span>`;
      li.addEventListener('click', () => {
        selectedArticleId = a.id;
        document.getElementById('inf-article-search').value = `${a.code} — ${a.libelle}`;
        results.classList.add('hidden');
        syncArticleSelects(a);
        updateArticlePreview();
      });
      results.appendChild(li);
    });
  }
  results.classList.remove('hidden');
});

// Garde les menus déroulants synchronisés avec l'article choisi via la recherche.
function syncArticleSelects(art) {
  const catSel = document.getElementById('inf-categorie');
  const artSel = document.getElementById('inf-article');
  catSel.value = art.categorie;
  fillArticleSelect(art.categorie);
  artSel.value = art.id;
}

function fillArticleSelect(categorie) {
  const sel = document.getElementById('inf-article');
  sel.innerHTML = '<option value="">Choisir un article...</option>';
  if (!categorie) { sel.disabled = true; return; }
  articlesCache.filter(a => a.categorie === categorie).forEach(a => {
    sel.insertAdjacentHTML('beforeend', `<option value="${a.id}">${escapeHtml(a.code)} — ${escapeHtml(a.libelle)} (${formatRyos(a.amende)})</option>`);
  });
  sel.disabled = false;
}

document.getElementById('inf-categorie').addEventListener('change', (e) => {
  selectedArticleId = null;
  document.getElementById('inf-article-search').value = '';
  document.getElementById('article-preview').classList.add('hidden');
  document.getElementById('recidive-alert').classList.add('hidden');
  document.getElementById('montant-total').classList.add('hidden');
  fillArticleSelect(e.target.value);
});

document.getElementById('inf-article').addEventListener('change', (e) => {
  selectedArticleId = e.target.value || null;
  document.getElementById('inf-article-search').value = '';
  document.getElementById('inf-article-results').classList.add('hidden');
  updateArticlePreview();
});

document.getElementById('inf-aggravante').addEventListener('change', () => updateArticlePreview(true));

let recidiveNiveauCourant = 0;

async function updateArticlePreview(keepRecidive) {
  const preview = document.getElementById('article-preview');
  const alertBox = document.getElementById('recidive-alert');
  const totalBox = document.getElementById('montant-total');
  if (!selectedArticleId) {
    preview.classList.add('hidden'); alertBox.classList.add('hidden'); totalBox.classList.add('hidden');
    return;
  }
  const art = articlesCache.find(a => a.id === selectedArticleId);
  if (!art) return;

  preview.classList.remove('hidden');
  preview.innerHTML = `
    <div class="ap-row"><span class="ap-label">Amende de base</span><strong>${formatRyos(art.amende)}</strong></div>
    <div class="ap-row"><span class="ap-label">Cellule</span><span>${art.cellule_minutes ? art.cellule_minutes + ' min' : 'N/A'}</span></div>
    <div class="ap-row"><span class="ap-label">Comparution</span><span>${boolBadge(art.comparution)}</span></div>
    <div class="ap-row"><span class="ap-label">Jugement</span><span>${jugementBadge(art.jugement)}</span></div>`;

  if (!keepRecidive) {
    recidiveNiveauCourant = await computeRecidiveNiveau(art.id);
  }
  if (recidiveNiveauCourant === 1) {
    alertBox.className = 'recidive-alert niveau1';
    alertBox.textContent = 'Récidive du même article sous 1 an (1ère) — surcharge de +20% appliquée automatiquement.';
    alertBox.classList.remove('hidden');
  } else if (recidiveNiveauCourant === 2) {
    alertBox.className = 'recidive-alert niveau2';
    alertBox.textContent = 'Récidive du même article sous 1 an (2e ou plus) — surcharge de +40% appliquée automatiquement.';
    alertBox.classList.remove('hidden');
  } else {
    alertBox.classList.add('hidden');
  }

  const aggravante = document.getElementById('inf-aggravante').checked;
  let multiplier = recidiveNiveauCourant === 1 ? 1.2 : recidiveNiveauCourant === 2 ? 1.4 : 1;
  let total = art.amende * multiplier;
  if (aggravante) total *= 2;
  totalBox.classList.remove('hidden');
  totalBox.textContent = `Montant total : ${formatRyos(total)}`;
}

async function computeRecidiveNiveau(articleId) {
  try {
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await supaGet('infractions',
      `ninja_char_key=eq.${encodeURIComponent(selectedNinjaKey)}&article_id=eq.${articleId}&created_at=gte.${oneYearAgo}&select=id`);
    if (rows.length >= 2) return 2;
    if (rows.length === 1) return 1;
    return 0;
  } catch (e) { console.error(e); return 0; }
}

document.getElementById('infraction-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('infraction-status');
  statusEl.textContent = '';
  const art = articlesCache.find(a => a.id === selectedArticleId);
  if (!art || !selectedNinjaKey) { statusEl.textContent = 'Sélectionne un article.'; return; }

  const aggravante = document.getElementById('inf-aggravante').checked;
  const multiplier = recidiveNiveauCourant === 1 ? 1.2 : recidiveNiveauCourant === 2 ? 1.4 : 1;
  let montant = Math.round(art.amende * multiplier);
  if (aggravante) montant *= 2;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    await supaPost('infractions', {
      ninja_char_key: selectedNinjaKey,
      ninja_nom: selectedNinjaNom,
      article_id: art.id,
      montant,
      recidive_niveau: recidiveNiveauCourant,
      circonstance_aggravante: aggravante,
      cellule_minutes: art.cellule_minutes,
      comparution: art.comparution,
      jugement: art.jugement,
      commentaire: document.getElementById('inf-commentaire').value.trim() || null,
      agent_id: currentUser.id
    }, true);

    document.getElementById('infraction-form').reset();
    selectedArticleId = null;
    document.getElementById('inf-article-results').classList.add('hidden');
    document.getElementById('inf-article').disabled = true;
    document.getElementById('article-preview').classList.add('hidden');
    document.getElementById('recidive-alert').classList.add('hidden');
    document.getElementById('montant-total').classList.add('hidden');
    recidiveNiveauCourant = 0;
    await loadInfractionsList();
    loadHistorique();
    loadRegistreCasiers();
  } catch (err) {
    statusEl.textContent = "Erreur lors de l'enregistrement.";
    console.error(err);
  } finally {
    submitBtn.disabled = false;
  }
});

// ── Historique global ──
document.getElementById('hist-statut').addEventListener('change', () => loadHistorique());
document.getElementById('hist-categorie').addEventListener('change', () => loadHistorique());
let histSearchTimer = null;
document.getElementById('hist-search').addEventListener('input', () => {
  clearTimeout(histSearchTimer);
  histSearchTimer = setTimeout(() => loadHistorique(), 250);
});

async function loadHistorique() {
  const ul = document.getElementById('historique-list');
  if (!ul || !document.getElementById('dashboard-screen') || document.getElementById('dashboard-screen').classList.contains('hidden')) return;
  ul.innerHTML = '<li class="list-empty">Chargement...</li>';
  try {
    const statut = document.getElementById('hist-statut').value;
    const categorie = document.getElementById('hist-categorie').value;
    const search = document.getElementById('hist-search').value.trim().toLowerCase();
    let query = 'select=*,articles_code_penal(code,libelle,categorie),agents(nom,prenom)&order=created_at.desc&limit=200';
    if (statut === 'paye') query += '&paye=eq.true';
    if (statut === 'impaye') query += '&paye=eq.false';
    const rows = await supaGet('infractions', query);
    let filtered = categorie ? rows.filter(r => r.articles_code_penal && r.articles_code_penal.categorie === categorie) : rows;
    if (search) {
      filtered = filtered.filter(r => {
        const art = r.articles_code_penal || {};
        return (r.ninja_nom || '').toLowerCase().includes(search)
          || (art.code || '').toLowerCase().includes(search)
          || (art.libelle || '').toLowerCase().includes(search);
      });
    }
    ul.innerHTML = '';
    if (filtered.length === 0) {
      ul.innerHTML = '<li class="list-empty">Aucune infraction enregistrée</li>';
      return;
    }
    filtered.forEach(r => {
      const li = renderInfractionItem(r);
      const meta = li.querySelector('.infraction-meta');
      if (meta && r.agents) {
        meta.innerHTML += ` · Ninja : <strong>${escapeHtml(r.ninja_nom)}</strong> · Agent : ${escapeHtml(r.agents.prenom)} ${escapeHtml(r.agents.nom)}`;
      }
      ul.appendChild(li);
    });
  } catch (e) {
    console.error(e);
    ul.innerHTML = '<li class="list-empty">Erreur de chargement</li>';
  }
}

// ── Table du Code Pénal ──
function renderCodePenalTables() {
  const wrap = document.getElementById('code-penal-tables');
  if (!articlesCache.length) { wrap.innerHTML = '<p class="info-text">Chargement...</p>'; loadArticlesCache().then(renderCodePenalTables); return; }
  const cats = [
    { key: 'mineur', label: 'Délits mineurs' },
    { key: 'majeur', label: 'Délits majeurs' },
    { key: 'crime', label: 'Crimes' }
  ];
  wrap.innerHTML = cats.map(cat => {
    const rows = articlesCache.filter(a => a.categorie === cat.key);
    if (!rows.length) return '';
    return `
      <table class="code-table">
        <caption>${cat.label}</caption>
        <thead><tr><th>Art.</th><th>Libellé</th><th>Amende</th><th>Cellule</th><th>Comparution</th><th>Jugement</th></tr></thead>
        <tbody>
          ${rows.map(a => `
            <tr class="cat-${cat.key}">
              <td class="num">${escapeHtml(a.code)}</td>
              <td>${escapeHtml(a.libelle)}</td>
              <td class="amount">${formatRyos(a.amende)}</td>
              <td>${a.cellule_minutes ? a.cellule_minutes + ' min' : 'N/A'}</td>
              <td>${boolBadge(a.comparution)}</td>
              <td>${jugementBadge(a.jugement)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }).join('');
}

// ── Dossiers d'enquête ──
const DOSSIER_STATUT_LABELS = { ouvert: 'Ouvert', en_cours: 'En cours', clos: 'Clos' };

document.getElementById('dossier-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const titre = document.getElementById('dossier-titre').value.trim();
  if (!titre) return;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    await supaPost('dossiers_enquete', {
      titre,
      ninja_nom: document.getElementById('dossier-ninja').value.trim() || null,
      description: document.getElementById('dossier-description').value.trim() || null,
      statut: document.getElementById('dossier-statut').value,
      created_by: currentUser.id
    }, true);
    document.getElementById('dossier-form').reset();
    loadDossiers();
  } catch (err) {
    console.error(err);
  } finally {
    submitBtn.disabled = false;
  }
});

let dossiersCache = [];
let openDossierId = null;

async function loadDossiers() {
  const ul = document.getElementById('dossiers-list');
  ul.innerHTML = '<li class="list-empty">Chargement...</li>';
  try {
    const rows = await supaGet('dossiers_enquete', 'select=*,agents(nom,prenom)&order=created_at.desc');
    dossiersCache = rows;
    ul.innerHTML = '';
    if (rows.length === 0) {
      ul.innerHTML = '<li class="list-empty">Aucun dossier d\'enquête pour le moment</li>';
      return;
    }
    rows.forEach(d => {
      const li = document.createElement('li');
      const date = new Date(d.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      li.className = 'dossier-folder';
      li.innerHTML = `
        <span class="dossier-folder-ico"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/></svg></span>
        <div class="dossier-folder-info">
          <div class="infraction-titre">${escapeHtml(d.titre)}</div>
          <div class="infraction-meta">${d.ninja_nom ? escapeHtml(d.ninja_nom) + ' · ' : ''}${date}</div>
        </div>
        <span class="tag dossier-statut-tag dossier-statut-${d.statut}">${DOSSIER_STATUT_LABELS[d.statut] || d.statut}</span>`;
      li.addEventListener('click', () => openDossierModal(d.id));
      ul.appendChild(li);
    });
  } catch (e) {
    console.error(e);
    ul.innerHTML = '<li class="list-empty">Erreur de chargement des dossiers</li>';
  }
}

async function openDossierModal(id) {
  const d = dossiersCache.find(x => x.id === id);
  if (!d) return;
  openDossierId = id;
  const date = new Date(d.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const auteur = d.agents ? `${d.agents.prenom} ${d.agents.nom}` : 'agent supprimé';
  document.getElementById('dossier-modal-titre').textContent = d.titre;
  document.getElementById('dossier-modal-meta').textContent = `${d.ninja_nom ? d.ninja_nom + ' · ' : ''}Ouvert le ${date} par ${auteur}`;
  document.getElementById('dossier-modal-statut').value = d.statut;
  document.getElementById('dossier-modal-description').textContent = d.description || 'Aucune description.';
  document.getElementById('dossier-note-form').reset();
  document.getElementById('dossier-modal-overlay').classList.remove('hidden');
  await Promise.all([loadDossierNotes(id), loadDossierGallery(id)]);
}

document.getElementById('dossier-modal-close').addEventListener('click', () => {
  document.getElementById('dossier-modal-overlay').classList.add('hidden');
  openDossierId = null;
});

document.getElementById('dossier-modal-statut').addEventListener('change', async (e) => {
  if (!openDossierId) return;
  try {
    await supaPatch('dossiers_enquete', `id=eq.${openDossierId}`, { statut: e.target.value, updated_at: new Date().toISOString() }, true);
    loadDossiers();
  } catch (err) { console.error(err); }
});

document.getElementById('dossier-delete-btn').addEventListener('click', async () => {
  if (!openDossierId) return;
  if (!confirm('Supprimer définitivement ce dossier (notes et photos incluses) ?')) return;
  try {
    await supaDelete('dossiers_enquete', `id=eq.${openDossierId}`);
    document.getElementById('dossier-modal-overlay').classList.add('hidden');
    openDossierId = null;
    loadDossiers();
  } catch (err) { console.error(err); }
});

async function loadDossierNotes(id) {
  const ul = document.getElementById('dossier-notes-list');
  ul.innerHTML = '<li class="list-empty">Chargement...</li>';
  try {
    const notes = await supaGet('dossier_notes', `dossier_id=eq.${id}&select=*,agents(nom,prenom)&order=created_at.desc`);
    ul.innerHTML = '';
    if (notes.length === 0) {
      ul.innerHTML = '<li class="list-empty">Aucune note pour le moment</li>';
      return;
    }
    notes.forEach(n => {
      const li = document.createElement('li');
      const date = new Date(n.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const auteur = n.agents ? `${n.agents.prenom} ${n.agents.nom}` : 'agent supprimé';
      li.innerHTML = `
        <div class="infraction-meta">${date} · ${escapeHtml(auteur)}</div>
        <div class="infraction-titre" style="font-weight:400;font-size:13.5px;">${escapeHtml(n.contenu)}</div>`;
      ul.appendChild(li);
    });
  } catch (e) {
    console.error(e);
    ul.innerHTML = '<li class="list-empty">Erreur de chargement des notes</li>';
  }
}

document.getElementById('dossier-note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!openDossierId) return;
  const contenu = document.getElementById('dossier-note-contenu').value.trim();
  if (!contenu) return;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    await supaPost('dossier_notes', { dossier_id: openDossierId, contenu, agent_id: currentUser.id }, true);
    document.getElementById('dossier-note-form').reset();
    loadDossierNotes(openDossierId);
  } catch (err) {
    console.error(err);
  } finally {
    submitBtn.disabled = false;
  }
});

async function loadDossierGallery(id) {
  const wrap = document.getElementById('dossier-modal-gallery');
  wrap.innerHTML = '';
  try {
    const photos = await supaGet('dossier_photos', `dossier_id=eq.${id}&select=id,photo_data&order=created_at.asc`);
    photos.forEach(p => {
      const item = document.createElement('div');
      item.className = 'dossier-photo-item';
      const img = document.createElement('img');
      img.className = 'dossier-photo-thumb';
      img.src = p.photo_data;
      img.alt = 'Preuve';
      img.addEventListener('click', () => {
        document.getElementById('photo-zoom-img').src = p.photo_data;
        document.getElementById('photo-zoom-overlay').classList.remove('hidden');
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'dossier-photo-del';
      delBtn.type = 'button';
      delBtn.title = 'Supprimer cette photo';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm('Supprimer cette photo ?')) return;
        try {
          await supaDelete('dossier_photos', `id=eq.${p.id}`);
          loadDossierGallery(id);
        } catch (err) { console.error(err); }
      });
      item.appendChild(img);
      item.appendChild(delBtn);
      wrap.appendChild(item);
    });
    const addZone = document.createElement('div');
    addZone.className = 'dossier-photo-add';
    addZone.id = 'dossier-photo-add-zone';
    addZone.title = 'Cliquer pour choisir une image, ou coller (Ctrl+V)';
    addZone.textContent = '+ Photo';
    addZone.addEventListener('click', () => {
      addZone.classList.add('active');
      addZone.textContent = 'Colle (Ctrl+V)';
      document.getElementById('photo-file-input').click();
    });
    wrap.appendChild(addZone);
  } catch (e) { console.error(e); }
}

initThemeToggle();
