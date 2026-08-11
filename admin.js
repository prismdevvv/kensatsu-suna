// =====================================================================
// admin.js — Direction de la Kensatsu de Sunagakure (réservé role='gerant')
// Dépend de common.js.
// =====================================================================

const SESSION_KEY = 'kensatsu_session';
const ROLE_LABELS = { gerant: 'Gérant', procureur: 'Procureur', agent: 'Agent' };

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
    if (users[0].role !== 'gerant') {
      errEl.textContent = "Accès réservé à la gérance.";
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
  loadStats();
  loadAgents();
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

(function restoreSession() {
  const saved = loadSession(SESSION_KEY);
  if (saved && saved.role === 'gerant') { currentUser = saved; showAdmin(); }
})();

// --- Statistiques ---
async function loadStats() {
  try {
    const infractions = await supaGet('infractions', 'select=id,montant,paye,agent_id,agents(nom,prenom,role)');
    const agentsList = await supaGet('agents', 'select=id&actif=eq.true');

    const totalCollecte = infractions.filter(i => i.paye).reduce((s, i) => s + i.montant, 0);
    const totalImpaye = infractions.filter(i => !i.paye).reduce((s, i) => s + i.montant, 0);

    document.getElementById('stat-total-infractions').textContent = infractions.length;
    document.getElementById('stat-total-collecte').textContent = formatRyos(totalCollecte);
    document.getElementById('stat-total-impaye').textContent = formatRyos(totalImpaye);
    document.getElementById('stat-total-agents').textContent = agentsList.length;

    const parAgent = {};
    infractions.forEach(i => {
      const key = i.agent_id || 'inconnu';
      if (!parAgent[key]) parAgent[key] = { agent: i.agents, count: 0, total: 0 };
      parAgent[key].count += 1;
      parAgent[key].total += i.paye ? i.montant : 0;
    });

    const tbody = document.getElementById('stats-agents-body');
    tbody.innerHTML = '';
    Object.values(parAgent).sort((a, b) => b.count - a.count).forEach(row => {
      const a = row.agent;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${a ? escapeHtml(a.prenom + ' ' + a.nom) : 'Agent supprimé'}</td>
        <td>${a ? '<span class="role-badge ' + a.role + '">' + (ROLE_LABELS[a.role] || a.role) + '</span>' : '—'}</td>
        <td>${row.count}</td>
        <td>${formatRyos(row.total)}</td>`;
      tbody.appendChild(tr);
    });
  } catch (e) { console.error(e); }
}

// --- Gestion des agents ---
async function loadAgents() {
  try {
    const agentsList = await supaGet('agents', 'select=id,nom,prenom,role,grade,actif&order=nom.asc,prenom.asc');
    const tbody = document.getElementById('agents-body');
    tbody.innerHTML = '';
    agentsList.forEach(a => {
      const tr = document.createElement('tr');
      const roleBtn = (r) => `<button class="btn-role ${r}" data-id="${a.id}" data-role="${r}"${a.role === r ? ' disabled' : ''}>${ROLE_LABELS[r]}</button>`;
      tr.innerHTML = `
        <td>${escapeHtml(a.prenom)} ${escapeHtml(a.nom)}</td>
        <td><span class="role-badge ${a.role}">${ROLE_LABELS[a.role] || a.role}</span></td>
        <td>${roleBtn('agent') + roleBtn('procureur') + roleBtn('gerant')}</td>
        <td><button class="btn-toggle-actif ${a.actif ? '' : 'inactif'}" data-id="${a.id}" data-actif="${a.actif}">${a.actif ? 'Actif' : 'Désactivé'}</button></td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-role').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const role = btn.dataset.role;
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
  } catch (e) { console.error(e); }
}

initThemeToggle();
