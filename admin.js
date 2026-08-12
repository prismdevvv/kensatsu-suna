// =====================================================================
// admin.js — Direction de la Kensatsu de Sunagakure (réservé role='gerant')
// Dépend de common.js.
// =====================================================================

const SESSION_KEY = 'kensatsu_session';
const ROLE_ORDER = ['gardien_provisoire', 'gardien_confirme', 'sergent', 'lieutenant', 'capitaine', 'commandant', 'co_gerant', 'gerant'];
const ROLE_LABELS = {
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

const PERMISSION_ACTIONS = [
  { key: 'emettre_amende', label: 'Émettre une amende' },
  { key: 'marquer_paye', label: 'Marquer payé / impayé' },
  { key: 'supprimer_infraction', label: 'Supprimer une infraction / plainte' },
  { key: 'acces_dossiers', label: 'Créer / gérer les dossiers d\'enquête' },
  { key: 'acces_gerance', label: 'Accéder à la gérance' },
  { key: 'gerer_agents', label: 'Gérer les agents (grades, activation, suppression)' }
];
const PERMISSION_DEFAULTS = {
  emettre_amende: true, marquer_paye: true, supprimer_infraction: false,
  acces_dossiers: false, acces_gerance: false, gerer_agents: false
};

// Vérifie l'accès gérance pour un rôle donné, avec repli sur l'ancien
// modèle figé (co_gerant/gerant) si la table permissions est absente.
async function checkAccesGerance(role) {
  if (role === 'gerant') return true;
  try {
    const rows = await supaGet('permissions', `role=eq.${role}&action=eq.acces_gerance`);
    if (rows.length === 0) throw new Error('vide');
    return !!rows[0].allowed;
  } catch (e) {
    return ADMIN_ROLES.includes(role);
  }
}

let currentPermissions = null;
async function loadMyPermissions() {
  if (currentUser.role === 'gerant') { currentPermissions = null; return; }
  try {
    const rows = await supaGet('permissions', `role=eq.${currentUser.role}`);
    if (rows.length === 0) throw new Error('vide');
    const map = { ...PERMISSION_DEFAULTS };
    rows.forEach(r => { map[r.action] = r.allowed; });
    currentPermissions = map;
  } catch (e) {
    const fallback = { ...PERMISSION_DEFAULTS };
    if (ADMIN_ROLES.includes(currentUser.role)) { fallback.gerer_agents = true; fallback.acces_gerance = true; fallback.supprimer_infraction = true; }
    currentPermissions = fallback;
  }
}
function can(action) {
  if (currentUser && currentUser.role === 'gerant') return true;
  return !!(currentPermissions && currentPermissions[action]);
}

function agentChip(prenom, nom) {
  const initiale = (prenom || '?').charAt(0).toUpperCase();
  return `<span class="agent-chip"><span class="agent-avatar">${escapeHtml(initiale)}</span>${escapeHtml(prenom)} ${escapeHtml(nom)}</span>`;
}

let currentUser = null;

const loginThrottle = makeLoginThrottle('kensatsu_admin_throttle');

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
    if (!(await checkAccesGerance(users[0].role))) {
      errEl.textContent = "Tu n'as pas la permission d'accéder à la gérance.";
      return;
    }
    loginThrottle.registerSuccess();
    currentUser = users[0];
    saveSession(SESSION_KEY, currentUser);
    showAdmin();
  } catch (err) {
    errEl.textContent = 'Erreur de connexion au registre.';
    console.error(err);
  } finally {
    submitBtn.disabled = false;
  }
});

function showAdmin() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('admin-screen').classList.remove('hidden');
  document.getElementById('user-name').textContent = `${currentUser.prenom} ${currentUser.nom}`;
  const badge = document.getElementById('user-role-badge');
  badge.textContent = ROLE_LABELS[currentUser.role] || currentUser.role;
  badge.className = `role-badge ${currentUser.role}`;
  loadMyPermissions().then(() => loadAgents());
  loadStats();
  populateAgentSelects();
  loadCompta();
  loadServiceHistorique();
  loadPermissionsTable();
}

document.querySelectorAll('.snav').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.group-panel').forEach(p => p.classList.toggle('active', p.dataset.group === b.dataset.group));
    document.querySelectorAll('.snav').forEach(x => x.classList.toggle('active', x === b));
  });
});

document.getElementById('logout-btn').addEventListener('click', () => {
  currentUser = null;
  clearSession(SESSION_KEY);
  document.getElementById('admin-screen').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('login-form').reset();
});

(async function restoreSession() {
  const saved = loadSession(SESSION_KEY);
  if (saved && (await checkAccesGerance(saved.role))) { currentUser = saved; showAdmin(); }
})();

// --- Statistiques ---
async function loadStats() {
  try {
    const infractions = await supaGet('infractions', 'select=id,ninja_char_key');
    const agentsList = await supaGet('agents', 'select=id&actif=eq.true');

    document.getElementById('stat-total-infractions').textContent = infractions.length;
    document.getElementById('stat-total-agents').textContent = agentsList.length;

    const casiersUniques = new Set();
    infractions.forEach(i => casiersUniques.add(i.ninja_char_key));
    document.getElementById('stat-total-casiers').textContent = casiersUniques.size;

    try {
      const dossiers = await supaGet('dossiers_enquete', 'select=id');
      document.getElementById('stat-total-dossiers').textContent = dossiers.length;
    } catch (e) { document.getElementById('stat-total-dossiers').textContent = '—'; }

    try {
      const plaintes = await supaGet('plaintes', 'select=id');
      document.getElementById('stat-total-plaintes').textContent = plaintes.length;
    } catch (e) { document.getElementById('stat-total-plaintes').textContent = '—'; }

    try {
      const enService = await supaGet('postes', 'actif=eq.true&select=id');
      document.getElementById('stat-en-service').textContent = enService.length;
    } catch (e) { document.getElementById('stat-en-service').textContent = '—'; }
  } catch (e) { console.error(e); }
}

// --- Gestion des agents ---
async function loadAgents() {
  try {
    const agentsList = await supaGet('agents', 'select=id,nom,prenom,role,specialisations,actif&order=nom.asc,prenom.asc');
    const tbody = document.getElementById('agents-body');
    tbody.innerHTML = '';
    const editable = can('gerer_agents');
    agentsList.forEach(a => {
      const tr = document.createElement('tr');
      const options = ROLE_ORDER.map(r => `<option value="${r}"${a.role === r ? ' selected' : ''}>${ROLE_LABELS[r]}</option>`).join('');
      const isEnqueteur = Array.isArray(a.specialisations) && a.specialisations.includes('enquete');
      tr.innerHTML = editable ? `
        <td>${agentChip(a.prenom, a.nom)}</td>
        <td><span class="role-badge ${a.role}">${ROLE_LABELS[a.role] || a.role}</span></td>
        <td><select class="role-select" data-id="${a.id}">${options}</select></td>
        <td style="text-align:center;"><input type="checkbox" class="specialisation-check" data-id="${a.id}"${isEnqueteur ? ' checked' : ''}></td>
        <td><button class="btn-toggle-actif ${a.actif ? '' : 'inactif'}" data-id="${a.id}" data-actif="${a.actif}">${a.actif ? 'Actif' : 'Désactivé'}</button></td>
        <td><button class="btn-delete-agent" data-id="${a.id}" data-nom="${escapeHtml(a.prenom)} ${escapeHtml(a.nom)}">Supprimer</button></td>` : `
        <td>${agentChip(a.prenom, a.nom)}</td>
        <td><span class="role-badge ${a.role}">${ROLE_LABELS[a.role] || a.role}</span></td>
        <td colspan="4" style="color:var(--text-light);">Lecture seule — permission "Gérer les agents" requise</td>`;
      tbody.appendChild(tr);
    });
    if (!editable) return;

    tbody.querySelectorAll('.role-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const id = sel.dataset.id;
        const role = sel.value;
        try {
          await supaPatch('agents', `id=eq.${id}`, { role }, true);
          if (currentUser && id === currentUser.id) {
            currentUser.role = role;
            saveSession(SESSION_KEY, currentUser);
          }
          loadAgents();
        } catch (e) { console.error(e); }
      });
    });

    tbody.querySelectorAll('.specialisation-check').forEach(chk => {
      chk.addEventListener('change', async () => {
        const id = chk.dataset.id;
        try {
          await supaPatch('agents', `id=eq.${id}`, { specialisations: chk.checked ? ['enquete'] : [] }, true);
        } catch (e) { console.error(e); }
      });
    });

    tbody.querySelectorAll('.btn-toggle-actif').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const nowActif = btn.dataset.actif === 'true';
        try {
          await supaPatch('agents', `id=eq.${id}`, { actif: !nowActif }, true);
          loadAgents();
        } catch (e) { console.error(e); }
      });
    });

    tbody.querySelectorAll('.btn-delete-agent').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm(`Supprimer définitivement l'agent ${btn.dataset.nom} ? Ses amendes déjà émises seront conservées (sans agent associé).`)) return;
        try {
          await supaDelete('agents', `id=eq.${id}`);
          loadAgents();
          loadStats();
        } catch (e) { console.error(e); }
      });
    });
  } catch (e) { console.error(e); }
}

// --- Sélecteurs d'agent partagés (Comptabilité / Service) ---
async function populateAgentSelects() {
  try {
    const agentsList = await supaGet('agents', 'select=id,nom,prenom&order=nom.asc,prenom.asc');
    ['compta-agent', 'service-agent'].forEach(id => {
      const sel = document.getElementById(id);
      sel.innerHTML = '<option value="all">Tous</option>';
      agentsList.forEach(a => {
        sel.insertAdjacentHTML('beforeend', `<option value="${a.id}">${escapeHtml(a.prenom)} ${escapeHtml(a.nom)}</option>`);
      });
    });
  } catch (e) { console.error(e); }
}

// --- Bornes de période partagées ---
function getPeriodRange(period) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'today') return { start: startOfDay, end: null };
  if (period === 'week') {
    const dayIdx = (now.getDay() + 6) % 7; // lundi = 0
    const start = new Date(startOfDay); start.setDate(start.getDate() - dayIdx);
    return { start, end: null };
  }
  if (period === 'week-1') {
    const dayIdx = (now.getDay() + 6) % 7;
    const startThis = new Date(startOfDay); startThis.setDate(startThis.getDate() - dayIdx);
    const start = new Date(startThis); start.setDate(start.getDate() - 7);
    return { start, end: startThis };
  }
  if (period === 'month') {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null };
  }
  return { start: null, end: null };
}

// --- Comptabilité ---
document.getElementById('compta-refresh').addEventListener('click', () => loadCompta());

async function loadCompta() {
  try {
    const { start, end } = getPeriodRange(document.getElementById('compta-periode').value);
    const agentFilter = document.getElementById('compta-agent').value;
    const categorieFilter = document.getElementById('compta-categorie').value;

    let query = 'select=*,articles_code_penal(categorie),agents(nom,prenom)';
    if (start) query += `&created_at=gte.${start.toISOString()}`;
    if (end) query += `&created_at=lt.${end.toISOString()}`;
    if (agentFilter !== 'all') query += `&agent_id=eq.${agentFilter}`;

    let rows = await supaGet('infractions', query);
    if (categorieFilter) rows = rows.filter(r => r.articles_code_penal && r.articles_code_penal.categorie === categorieFilter);

    const collecte = rows.filter(r => r.paye).reduce((s, r) => s + r.montant, 0);
    const impaye = rows.filter(r => !r.paye).reduce((s, r) => s + r.montant, 0);
    document.getElementById('compta-total').textContent = rows.length;
    document.getElementById('compta-collecte').textContent = formatRyos(collecte);
    document.getElementById('compta-impaye').textContent = formatRyos(impaye);
    document.getElementById('compta-emis').textContent = formatRyos(collecte + impaye);

    const parAgent = {};
    rows.forEach(r => {
      const key = r.agent_id || 'inconnu';
      if (!parAgent[key]) parAgent[key] = { agent: r.agents, count: 0, collecte: 0, impaye: 0 };
      parAgent[key].count += 1;
      if (r.paye) parAgent[key].collecte += r.montant; else parAgent[key].impaye += r.montant;
    });
    const agentsBody = document.getElementById('compta-agents-body');
    agentsBody.innerHTML = '';
    Object.values(parAgent).sort((a, b) => (b.collecte + b.impaye) - (a.collecte + a.impaye)).forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.agent ? agentChip(row.agent.prenom, row.agent.nom) : 'Agent supprimé'}</td>
        <td>${row.count}</td>
        <td>${formatRyos(row.collecte)}</td>
        <td>${formatRyos(row.impaye)}</td>`;
      agentsBody.appendChild(tr);
    });
    if (Object.keys(parAgent).length === 0) agentsBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-light);">Aucune donnée sur cette période</td></tr>';

    const CAT_LABELS = { mineur: 'Délits mineurs', majeur: 'Délits majeurs', crime: 'Crimes' };
    const parCategorie = {};
    rows.forEach(r => {
      const cat = (r.articles_code_penal && r.articles_code_penal.categorie) || 'inconnue';
      if (!parCategorie[cat]) parCategorie[cat] = { count: 0, collecte: 0, impaye: 0 };
      parCategorie[cat].count += 1;
      if (r.paye) parCategorie[cat].collecte += r.montant; else parCategorie[cat].impaye += r.montant;
    });
    const catBody = document.getElementById('compta-categories-body');
    catBody.innerHTML = '';
    Object.entries(parCategorie).forEach(([cat, row]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${CAT_LABELS[cat] || cat}</td>
        <td>${row.count}</td>
        <td>${formatRyos(row.collecte)}</td>
        <td>${formatRyos(row.impaye)}</td>`;
      catBody.appendChild(tr);
    });
    if (Object.keys(parCategorie).length === 0) catBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-light);">Aucune donnée sur cette période</td></tr>';
  } catch (e) { console.error(e); }
}

// --- Historique des services ---
document.getElementById('service-refresh').addEventListener('click', () => loadServiceHistorique());

function formatDuree(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m} min`;
}

async function loadServiceHistorique() {
  try {
    const { start, end } = getPeriodRange(document.getElementById('service-periode').value);
    const agentFilter = document.getElementById('service-agent').value;

    let query = 'select=*,agents(nom,prenom)&order=debut.desc';
    if (start) query += `&debut=gte.${start.toISOString()}`;
    if (end) query += `&debut=lt.${end.toISOString()}`;
    if (agentFilter !== 'all') query += `&agent_id=eq.${agentFilter}`;

    const rows = await supaGet('postes', query);
    const now = Date.now();

    document.getElementById('service-en-cours').textContent = rows.filter(r => r.actif).length;
    document.getElementById('service-total-postes').textContent = rows.length;
    const totalMs = rows.reduce((s, r) => s + ((r.fin ? new Date(r.fin).getTime() : now) - new Date(r.debut).getTime()), 0);
    document.getElementById('service-total-temps').textContent = formatDuree(totalMs);

    const parAgent = {};
    rows.forEach(r => {
      const key = r.agent_id || 'inconnu';
      if (!parAgent[key]) parAgent[key] = { agent: r.agents, count: 0, totalMs: 0, dernier: r.debut };
      parAgent[key].count += 1;
      parAgent[key].totalMs += (r.fin ? new Date(r.fin).getTime() : now) - new Date(r.debut).getTime();
      if (new Date(r.debut) > new Date(parAgent[key].dernier)) parAgent[key].dernier = r.debut;
    });
    const tbody = document.getElementById('service-recap-body');
    tbody.innerHTML = '';
    Object.values(parAgent).sort((a, b) => b.totalMs - a.totalMs).forEach(row => {
      const tr = document.createElement('tr');
      const dernierDate = new Date(row.dernier).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      tr.innerHTML = `
        <td>${row.agent ? agentChip(row.agent.prenom, row.agent.nom) : 'Agent supprimé'}</td>
        <td>${row.count}</td>
        <td>${formatDuree(row.totalMs)}</td>
        <td>${formatDuree(row.totalMs / row.count)}</td>
        <td>${dernierDate}</td>`;
      tbody.appendChild(tr);
    });
    if (Object.keys(parAgent).length === 0) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-light);">Aucun service sur cette période</td></tr>';
  } catch (e) { console.error(e); }
}

// --- Tableau des permissions (édition par grade) ---
async function loadPermissionsTable() {
  const head = document.getElementById('permissions-table-head');
  const body = document.getElementById('permissions-table-body');
  head.innerHTML = '<th>Action</th>' + ROLE_ORDER.map(r => `<th>${ROLE_LABELS[r]}</th>`).join('');

  let rows = [];
  let tableMissing = false;
  try {
    rows = await supaGet('permissions', 'select=*');
    if (rows.length === 0) tableMissing = true;
  } catch (e) { tableMissing = true; }

  const current = {};
  ROLE_ORDER.forEach(r => { current[r] = { ...PERMISSION_DEFAULTS }; });
  if (ADMIN_ROLES.includes('co_gerant')) { current.co_gerant.acces_gerance = true; current.co_gerant.gerer_agents = true; current.co_gerant.supprimer_infraction = true; }
  current.gerant = { emettre_amende: true, marquer_paye: true, supprimer_infraction: true, acces_dossiers: true, acces_gerance: true, gerer_agents: true };
  rows.forEach(r => { if (current[r.role]) current[r.role][r.action] = r.allowed; });

  body.innerHTML = '';
  if (tableMissing) {
    body.innerHTML = `<tr><td colspan="${ROLE_ORDER.length + 1}" style="color:var(--text-light);">Table "permissions" pas encore créée — exécute db_export/10_migration_permissions.sql. En attendant, l'ancien comportement figé est utilisé (co-gérant/gérant = accès complet).</td></tr>`;
  }

  PERMISSION_ACTIONS.forEach(action => {
    const tr = document.createElement('tr');
    let cells = `<td>${escapeHtml(action.label)}</td>`;
    ROLE_ORDER.forEach(role => {
      if (role === 'gerant') {
        cells += `<td style="text-align:center;color:var(--green);font-weight:700;">✅ Toujours</td>`;
      } else {
        const allowed = current[role][action.key];
        cells += `<td><select class="perm-select" data-role="${role}" data-action="${action.key}">
          <option value="true"${allowed ? ' selected' : ''}>Autorisé</option>
          <option value="false"${!allowed ? ' selected' : ''}>Interdit</option>
        </select></td>`;
      }
    });
    tr.innerHTML = cells;
    body.appendChild(tr);
  });

  body.querySelectorAll('.perm-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const role = sel.dataset.role;
      const action = sel.dataset.action;
      const allowed = sel.value === 'true';
      try {
        await supaUpsert('permissions', { role, action, allowed }, '?on_conflict=role,action');
        if (currentUser && role === currentUser.role) await loadMyPermissions();
      } catch (e) {
        console.error(e);
        alert('Erreur : la table "permissions" n\'existe peut-être pas encore. Exécute db_export/10_migration_permissions.sql.');
      }
    });
  });
}

initThemeToggle();
