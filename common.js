// =====================================================================
// common.js — Fonctions partagées entre index.html (app.js) et
// admin.html (admin.js) : accès Supabase, hash du sceau, échappement
// HTML, gestion de session, thème clair/sombre.
//
// Même modèle que le repo seimei : voir SECURITY.md pour les limites
// de sécurité de ce modèle (clé publique Supabase + RPC).
// =====================================================================

const SUPABASE_URL = 'https://hvumajktloocqtoedvkg.supabase.co/rest/v1';
const SUPABASE_KEY = 'sb_publishable_sp55jxKjedJXmPgoZDqJzw_mp5I3Q0o';

const SUPA_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function supaError(res) {
  let detail = '';
  try { detail = await res.text(); } catch (_) {}
  console.error(`Supabase ${res.status} ${res.statusText}:`, detail);
  const err = new Error(detail || `Erreur ${res.status}`);
  err.status = res.status;
  err.raw = detail;
  return err;
}

function headersFor(minimal) {
  return minimal ? { ...SUPA_HEADERS, 'Prefer': 'return=minimal' } : SUPA_HEADERS;
}

async function supaGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/${table}?${query}`, { headers: SUPA_HEADERS });
  if (!res.ok) throw await supaError(res);
  return res.json();
}

async function supaPost(table, data, minimal = false) {
  const res = await fetch(`${SUPABASE_URL}/${table}`, {
    method: 'POST', headers: headersFor(minimal), body: JSON.stringify(data)
  });
  if (!res.ok) throw await supaError(res);
  return minimal ? null : res.json();
}

async function supaPatch(table, query, data, minimal = false) {
  const res = await fetch(`${SUPABASE_URL}/${table}?${query}`, {
    method: 'PATCH', headers: headersFor(minimal), body: JSON.stringify(data)
  });
  if (!res.ok) throw await supaError(res);
  return minimal ? null : res.json();
}

async function supaDelete(table, query) {
  const res = await fetch(`${SUPABASE_URL}/${table}?${query}`, { method: 'DELETE', headers: headersFor(true) });
  if (!res.ok) throw await supaError(res);
}

async function supaUpsert(table, data, query = '') {
  const res = await fetch(`${SUPABASE_URL}/${table}${query}`, {
    method: 'POST',
    headers: { ...SUPA_HEADERS, 'Prefer': 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw await supaError(res);
  return res.json();
}

async function supaRpc(fn, args = {}) {
  const res = await fetch(`${SUPABASE_URL}/rpc/${fn}`, {
    method: 'POST', headers: SUPA_HEADERS, body: JSON.stringify(args)
  });
  if (!res.ok) throw await supaError(res);
  return res.json();
}

// --- Hash du "sceau" (mot de passe RP) ---
async function hashSceau(sceau) {
  const data = new TextEncoder().encode(sceau);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text == null ? '' : String(text);
  return d.innerHTML;
}

// --- Session ---
function sanitizeUserForStorage(user) {
  if (!user) return null;
  const { sceau, ...safe } = user;
  return safe;
}

function saveSession(key, user) {
  localStorage.setItem(key, JSON.stringify(sanitizeUserForStorage(user)));
}

function loadSession(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function clearSession(key) {
  localStorage.removeItem(key);
}

// --- Anti-brute-force basique côté client ---
function makeLoginThrottle(storageKey, maxAttempts = 5, lockoutMs = 30000) {
  function state() {
    try { return JSON.parse(sessionStorage.getItem(storageKey)) || { count: 0, until: 0 }; }
    catch (_) { return { count: 0, until: 0 }; }
  }
  function save(s) { sessionStorage.setItem(storageKey, JSON.stringify(s)); }
  return {
    isLocked() {
      const s = state();
      return s.until > Date.now();
    },
    remainingSeconds() {
      const s = state();
      return Math.max(0, Math.ceil((s.until - Date.now()) / 1000));
    },
    registerFailure() {
      const s = state();
      s.count += 1;
      if (s.count >= maxAttempts) {
        s.until = Date.now() + lockoutMs;
        s.count = 0;
      }
      save(s);
    },
    registerSuccess() {
      save({ count: 0, until: 0 });
    }
  };
}

function generateTempSceau() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(36)).join('').slice(0, 10);
}

// --- Thème clair / sombre (identique sur les deux pages) ---
function initThemeToggle() {
  if (localStorage.getItem('kensatsu_theme') === 'dark') document.body.classList.add('dark');
  const ICO_SUN = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19"/></svg>';
  const ICO_MOON = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13.5A7.5 7.5 0 1 1 10.5 4 6 6 0 0 0 20 13.5Z"/></svg>';
  const tbtn = document.getElementById('theme-toggle');
  if (!tbtn) return;
  const sync = () => { tbtn.innerHTML = document.body.classList.contains('dark') ? ICO_SUN : ICO_MOON; };
  sync();
  tbtn.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('kensatsu_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
    sync();
  });
}

// --- Formatage Ryos ---
function formatRyos(n) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' ₽';
}

// --- Badge de jugement (❌ / ✅ / ⏳) ---
function jugementBadge(v) {
  if (v === 'oui') return '<span class="jbadge jbadge-oui" title="Jugement">✅</span>';
  if (v === 'attente') return '<span class="jbadge jbadge-attente" title="En attente de jugement">⏳</span>';
  return '<span class="jbadge jbadge-non" title="Pas de jugement">❌</span>';
}
function boolBadge(v) {
  return v ? '<span class="jbadge jbadge-oui" title="Oui">✅</span>' : '<span class="jbadge jbadge-non" title="Non">❌</span>';
}
