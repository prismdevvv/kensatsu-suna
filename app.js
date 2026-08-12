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

let currentUser = null;
let clockInterval = null;
let articlesCache = [];

const loginThrottle = makeLoginThrottle('kensatsu_login_throttle');

function updateClock() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

function showDashboard() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('hidden');
  document.getElementById('user-name').textContent = `${currentUser.prenom} ${currentUser.nom}`;
  const roleBadge = document.getElementById('user-role');
  roleBadge.textContent = AGENT_ROLE_LABELS[currentUser.role] || currentUser.role;
  roleBadge.className = 'role-badge ' + currentUser.role;
  document.getElementById('gerance-link').style.display = ADMIN_ROLES.includes(currentUser.role) ? 'inline-flex' : 'none';
  document.getElementById('dossiers-nav').style.display = (hasSpecialisation('enquete') || ADMIN_ROLES.includes(currentUser.role)) ? 'inline-flex' : 'none';
  updateClock();
  clockInterval = setInterval(updateClock, 1000);
  showGroup('casiers');
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
}
document.querySelectorAll('.snav').forEach(b => {
  b.addEventListener('click', () => showGroup(b.dataset.group));
});

document.getElementById('logout-btn').addEventListener('click', () => {
  currentUser = null;
  clearSession(SESSION_KEY);
  clearInterval(clockInterval);
  document.getElementById('dashboard-screen').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('login-form').reset();
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
async function loadRegistreCasiers() {
  const ul = document.getElementById('registre-list');
  ul.innerHTML = '<li class="list-empty">Chargement...</li>';
  try {
    const rows = await supaGet('infractions', 'select=ninja_char_key,ninja_nom,montant,paye,created_at&order=created_at.desc&limit=500');
    const map = {};
    rows.forEach(r => {
      if (!map[r.ninja_char_key]) map[r.ninja_char_key] = { nom: r.ninja_nom, count: 0, impaye: 0, derniere: r.created_at };
      map[r.ninja_char_key].count += 1;
      if (!r.paye) map[r.ninja_char_key].impaye += r.montant;
    });
    const list = Object.entries(map).sort((a, b) => new Date(b[1].derniere) - new Date(a[1].derniere));
    ul.innerHTML = '';
    if (list.length === 0) {
      ul.innerHTML = '<li class="list-empty">Aucun casier enregistré pour le moment</li>';
      return;
    }
    list.forEach(([key, info]) => {
      const li = document.createElement('li');
      const date = new Date(info.derniere).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      li.className = 'search-result';
      li.innerHTML = `<strong>${escapeHtml(info.nom)}</strong> <span class="infraction-meta">${info.count} infraction${info.count > 1 ? 's' : ''} · dernière le ${date}${info.impaye > 0 ? ' · <span class="tag tag-impaye">' + formatRyos(info.impaye) + ' impayé</span>' : ''}</span>`;
      li.addEventListener('click', () => openCasier(key, info.nom, `${info.count} infraction${info.count > 1 ? 's' : ''} au casier`));
      ul.appendChild(li);
    });
  } catch (e) {
    console.error(e);
    ul.innerHTML = '<li class="list-empty">Erreur de chargement du registre</li>';
  }
}

// ── Casier judiciaire (modal) ──
async function openCasier(key, nom, meta) {
  selectedNinjaKey = key;
  selectedNinjaNom = nom;
  document.getElementById('casier-nom').textContent = nom;
  document.getElementById('casier-meta').textContent = meta || '';
  document.getElementById('infraction-form').reset();
  document.getElementById('inf-article').innerHTML = '<option value="">Choisir un article...</option>';
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

window.addEventListener('paste', async (e) => {
  const overlay = document.getElementById('casier-modal-overlay');
  if (!overlay || overlay.classList.contains('hidden') || !selectedNinjaKey) return;
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      const hint = document.getElementById('casier-photo-hint');
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
      break;
    }
  }
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
        <button class="btn-delete-inf" data-id="${r.id}" title="Supprimer cette infraction">Supprimer</button>
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
  li.querySelector('.btn-delete-inf').addEventListener('click', async (ev) => {
    const id = ev.target.dataset.id;
    if (!confirm('Supprimer définitivement cette infraction du casier ?')) return;
    try {
      await supaDelete('infractions', `id=eq.${id}`);
      await loadInfractionsList();
      loadHistorique();
      loadRegistreCasiers();
    } catch (e) { console.error(e); }
  });
  return li;
}

// ── Formulaire d'ajout d'infraction ──
async function loadArticlesCache() {
  try {
    articlesCache = await supaGet('articles_code_penal', 'select=*&order=ordre.asc');
  } catch (e) { console.error(e); }
}

document.getElementById('inf-categorie').addEventListener('change', (e) => {
  const cat = e.target.value;
  const sel = document.getElementById('inf-article');
  sel.innerHTML = '<option value="">Choisir un article...</option>';
  document.getElementById('article-preview').classList.add('hidden');
  document.getElementById('recidive-alert').classList.add('hidden');
  document.getElementById('montant-total').classList.add('hidden');
  if (!cat) { sel.disabled = true; return; }
  articlesCache.filter(a => a.categorie === cat).forEach(a => {
    sel.insertAdjacentHTML('beforeend', `<option value="${a.id}">${escapeHtml(a.code)} — ${escapeHtml(a.libelle)} (${formatRyos(a.amende)})</option>`);
  });
  sel.disabled = false;
});

document.getElementById('inf-article').addEventListener('change', () => updateArticlePreview());
document.getElementById('inf-aggravante').addEventListener('change', () => updateArticlePreview(true));

let recidiveNiveauCourant = 0;

async function updateArticlePreview(keepRecidive) {
  const articleId = document.getElementById('inf-article').value;
  const preview = document.getElementById('article-preview');
  const alertBox = document.getElementById('recidive-alert');
  const totalBox = document.getElementById('montant-total');
  if (!articleId) {
    preview.classList.add('hidden'); alertBox.classList.add('hidden'); totalBox.classList.add('hidden');
    return;
  }
  const art = articlesCache.find(a => a.id === articleId);
  if (!art) return;

  preview.classList.remove('hidden');
  preview.innerHTML = `
    <div class="ap-row"><span class="ap-label">Amende de base</span><strong>${formatRyos(art.amende)}</strong></div>
    <div class="ap-row"><span class="ap-label">Cellule</span><span>${art.cellule_minutes ? art.cellule_minutes + ' min' : 'N/A'}</span></div>
    <div class="ap-row"><span class="ap-label">Comparution</span><span>${boolBadge(art.comparution)}</span></div>
    <div class="ap-row"><span class="ap-label">Jugement</span><span>${jugementBadge(art.jugement)}</span></div>`;

  if (!keepRecidive) {
    recidiveNiveauCourant = await computeRecidiveNiveau();
  }
  if (recidiveNiveauCourant === 1) {
    alertBox.className = 'recidive-alert niveau1';
    alertBox.textContent = 'Récidive détectée sous 1 an (1ère) — surcharge de +20% appliquée automatiquement.';
    alertBox.classList.remove('hidden');
  } else if (recidiveNiveauCourant === 2) {
    alertBox.className = 'recidive-alert niveau2';
    alertBox.textContent = 'Récidive détectée sous 1 an (2e ou plus) — surcharge de +40% appliquée automatiquement.';
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

async function computeRecidiveNiveau() {
  try {
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await supaGet('infractions',
      `ninja_char_key=eq.${encodeURIComponent(selectedNinjaKey)}&created_at=gte.${oneYearAgo}&select=id`);
    if (rows.length >= 2) return 2;
    if (rows.length === 1) return 1;
    return 0;
  } catch (e) { console.error(e); return 0; }
}

document.getElementById('infraction-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('infraction-status');
  statusEl.textContent = '';
  const articleId = document.getElementById('inf-article').value;
  const art = articlesCache.find(a => a.id === articleId);
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
    document.getElementById('inf-article').innerHTML = '<option value="">Choisir un article...</option>';
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

async function loadHistorique() {
  const ul = document.getElementById('historique-list');
  if (!ul || !document.getElementById('dashboard-screen') || document.getElementById('dashboard-screen').classList.contains('hidden')) return;
  ul.innerHTML = '<li class="list-empty">Chargement...</li>';
  try {
    const statut = document.getElementById('hist-statut').value;
    const categorie = document.getElementById('hist-categorie').value;
    let query = 'select=*,articles_code_penal(code,libelle,categorie),agents(nom,prenom)&order=created_at.desc&limit=100';
    if (statut === 'paye') query += '&paye=eq.true';
    if (statut === 'impaye') query += '&paye=eq.false';
    const rows = await supaGet('infractions', query);
    const filtered = categorie ? rows.filter(r => r.articles_code_penal && r.articles_code_penal.categorie === categorie) : rows;
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

async function loadDossiers() {
  const ul = document.getElementById('dossiers-list');
  ul.innerHTML = '<li class="list-empty">Chargement...</li>';
  try {
    const rows = await supaGet('dossiers_enquete', 'select=*,agents(nom,prenom)&order=created_at.desc');
    ul.innerHTML = '';
    if (rows.length === 0) {
      ul.innerHTML = '<li class="list-empty">Aucun dossier d\'enquête pour le moment</li>';
      return;
    }
    rows.forEach(d => {
      const li = document.createElement('li');
      const date = new Date(d.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const auteur = d.agents ? `${d.agents.prenom} ${d.agents.nom}` : 'agent supprimé';
      const statutOptions = Object.entries(DOSSIER_STATUT_LABELS)
        .map(([v, l]) => `<option value="${v}"${d.statut === v ? ' selected' : ''}>${l}</option>`).join('');
      li.innerHTML = `
        <div class="infraction-item">
          <div class="infraction-left">
            <div class="infraction-titre">${escapeHtml(d.titre)}${d.ninja_nom ? ' — ' + escapeHtml(d.ninja_nom) : ''}</div>
            <div class="infraction-meta">Ouvert le ${date} par ${escapeHtml(auteur)}</div>
            ${d.description ? `<div class="infraction-meta">${escapeHtml(d.description)}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <select class="dossier-statut-select" data-id="${d.id}">${statutOptions}</select>
            <button class="btn-delete-inf" data-id="${d.id}">Supprimer</button>
          </div>
        </div>`;
      li.querySelector('.dossier-statut-select').addEventListener('change', async (ev) => {
        try {
          await supaPatch('dossiers_enquete', `id=eq.${d.id}`, { statut: ev.target.value, updated_at: new Date().toISOString() }, true);
        } catch (err) { console.error(err); }
      });
      li.querySelector('.btn-delete-inf').addEventListener('click', async () => {
        if (!confirm('Supprimer définitivement ce dossier ?')) return;
        try {
          await supaDelete('dossiers_enquete', `id=eq.${d.id}`);
          loadDossiers();
        } catch (err) { console.error(err); }
      });
      ul.appendChild(li);
    });
  } catch (e) {
    console.error(e);
    ul.innerHTML = '<li class="list-empty">Erreur de chargement des dossiers</li>';
  }
}

initThemeToggle();
