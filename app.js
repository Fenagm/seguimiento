// ─── PWA INSTALL PROMPT ───────────────────────────────────────────────────────
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBanner();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  hideInstallBanner();
  showToast('App instalada correctamente ✓');
});

function showInstallBanner() {
  const existing = document.getElementById('pwa-install-banner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
      <img src="icons/icon-72x72.png" alt="" style="width:36px;height:36px;border-radius:8px;flex-shrink:0;">
      <div style="min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--text);">Instalá la app</div>
        <div style="font-size:11px;color:var(--text3);">Acceso rápido desde la pantalla de inicio</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0;">
      <button id="pwa-install-dismiss" style="background:none;border:1px solid var(--border2);border-radius:6px;color:var(--text2);font-size:11px;padding:5px 10px;cursor:pointer;font-family:var(--sans);">Ahora no</button>
      <button id="pwa-install-btn" style="background:var(--accent);border:none;border-radius:6px;color:#fff;font-size:11px;font-weight:600;padding:5px 12px;cursor:pointer;font-family:var(--sans);">Instalar</button>
    </div>`;
  document.body.appendChild(banner);

  document.getElementById('pwa-install-btn').onclick = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') deferredInstallPrompt = null;
    hideInstallBanner();
  };
  document.getElementById('pwa-install-dismiss').onclick = () => {
    hideInstallBanner();
    localStorage.setItem('pwa-dismissed', Date.now());
  };
}

function hideInstallBanner() {
  document.getElementById('pwa-install-banner')?.remove();
}

// ─── IMPORTS ──────────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from 'firebase/auth';

// ─── CATEGORIES & TAGS ───────────────────────────────────────────────────────
export const CATS = [
  { id: 'nutricion', label: 'Nutrición', cls: 'nut', dot: '#2da44e' },
  { id: 'sedacion', label: 'Sedación', cls: 'sed', dot: '#c87af0' },
  { id: 'antibioticos', label: 'Antibióticos', cls: 'atb', dot: '#f5a623' },
  { id: 'qmt', label: 'QMT', cls: 'qmt', dot: '#ef5e5e' },
  { id: 'otros', label: 'Otros', cls: 'oth', dot: '#4ab3c7' },
];

export const TAGS = {
  nutricion: ['NPT Magistral 63 ml/h', 'Fresubin Original 63 ml/h', 'Fresubin Energy 42 ml/h', 'Protison 42 ml/h', 'NE por SNG', 'Ayuno', 'Dieta blanda'],
  sedacion: ['Midazolam', 'Metadona 5mg c/8h', 'Morfina', 'Oxicodona', 'Fentanilo', 'Propofol', 'Dexmedetomidina', 'Ketamina'],
  antibioticos: ['Vancomicina', 'Meropenem', 'Pip/Tazo 4,5g c/6h', 'Aciclovir 400mg c/12h', 'Caspofungina', 'Daptomicina', 'Ampicilina-Sulbactam', 'Colistin'],
  qmt: ['Rituximab + EPOCH', 'Ciclo 2', 'Carbo/Etopósido + Atezolizumab', 'FOLFIRI', 'FOLFOX', 'Cisplatino', 'Ciclofosfamida', 'Paclitaxel'],
  otros: ['Filgrastim', 'Bactrim forte', 'Isavuconazol', 'Ceftolozano + Tazobactam', 'Heparina', 'HBPM', 'Omeprazol', 'Dexametasona'],
};

export const DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];
export const DAY_LABELS = { lunes: 'Lun', martes: 'Mar', miercoles: 'Mié', jueves: 'Jue', viernes: 'Vie' };
export const FLOORS = ['3', '4', '5', 'tamo', 'uti', 'utiq'];
export const FLOOR_LABELS = { '3': 'Piso 3', '4': 'Piso 4', '5': 'Piso 5', 'tamo': 'TAMO', 'uti': 'UTI', 'utiq': 'UTI-Q' };

// ─── STATE ────────────────────────────────────────────────────────────────────
let db = null;
let auth = null;
let localMode = false;
let currentWeek = getWeekId(new Date());
let currentFloor = '3';
let allPatients = JSON.parse(localStorage.getItem('sc_patients') || '{}');
let weekData = JSON.parse(localStorage.getItem(`sc_week_${currentWeek}`) || '{}');
let pendingCSV = [];
let panelState = { hc: null, day: 'lunes', data: {} };
let currentDaysHc = null;
let movePatientHc = null;
let moveFilterFloor = 'all';
let moveSelectedRoom = null;
let weekAutosaveTimer = null;

// currentUser is set by Firebase Auth — single source of truth
let currentUser = null;
let auditLog = JSON.parse(localStorage.getItem('sc_audit_log') || '[]');

const PATIENT_STATUS = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
};

function normalizePatientRecord(patient) {
  if (!patient) return patient;
  if (!patient.status) {
    patient.status = PATIENT_STATUS.ACTIVE;
    return patient;
  }
  // Backward compatibility with older "discharged" records.
  if (patient.status === 'discharged') {
    patient.status = PATIENT_STATUS.ARCHIVED;
    patient.archivedReason = patient.archivedReason || 'discharge';
    patient.archivedAt = patient.archivedAt || patient.dischargeAt || new Date().toISOString();
  }
  return patient;
}

function isPatientActive(patient) {
  return normalizePatientRecord(patient)?.status === PATIENT_STATUS.ACTIVE;
}

function normalizeAllPatients() {
  let changed = false;
  Object.values(allPatients).forEach(p => {
    const before = p?.status;
    normalizePatientRecord(p);
    if ((p?.status || null) !== (before || null)) changed = true;
  });
  if (changed) localStorage.setItem('sc_patients', JSON.stringify(allPatients));
}

normalizeAllPatients();

// ─── AUDIT ────────────────────────────────────────────────────────────────────
function saveAudit(action, hc, day, details) {
  const entry = {
    timestamp: new Date().toISOString(),
    user: getDisplayName(currentUser),
    userId: currentUser?.uid || 'anonymous',
    action, hc, day,
    week: currentWeek,
    details,
  };
  auditLog.unshift(entry);
  if (auditLog.length > 1000) auditLog.pop();
  localStorage.setItem('sc_audit_log', JSON.stringify(auditLog));
  if (db) {
    setDoc(doc(db, 'audit', `${Date.now()}_${hc || 'sys'}_${day || 'na'}`), entry).catch(() => {});
  }
}

// ─── USER PROFILE ─────────────────────────────────────────────────────────────
// Display name priority: Firestore users/{uid}.name > Auth displayName > email prefix
let userProfileName = null;

async function loadUserProfile(uid) {
  if (!db || !uid) return;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      userProfileName = snap.data().name || null;
    }
  } catch (e) { /* offline */ }
}

function getDisplayName(user) {
  if (!user) return 'anónimo';
  return userProfileName || user.displayName || user.email.split('@')[0];
}

function updateUserUI(user) {
  const panel = document.getElementById('user-panel');
  const nameSpan = document.getElementById('user-name-display');
  if (user) {
    panel.style.display = 'flex';
    nameSpan.textContent = getDisplayName(user);
  } else {
    panel.style.display = 'none';
  }
}

function openProfileModal() {
  if (!currentUser) return;
  document.getElementById('profile-email').textContent = currentUser.email;
  document.getElementById('profile-name').value = getDisplayName(currentUser);
  const overlay = document.getElementById('profile-overlay');
  overlay.style.display = 'flex';
  setTimeout(() => document.getElementById('profile-name').select(), 50);
}

function closeProfileModal() {
  document.getElementById('profile-overlay').style.display = 'none';
}

async function saveUserProfile() {
  if (!currentUser) return;
  const name = document.getElementById('profile-name').value.trim();
  if (!name) { showToast('Ingresá un nombre'); return; }

  userProfileName = name;
  updateUserUI(currentUser);
  closeProfileModal();

  // Persist to Firestore
  if (db) {
    await setDoc(doc(db, 'users', currentUser.uid), {
      name,
      email: currentUser.email,
      uid: currentUser.uid,
      updatedAt: new Date().toISOString(),
    }, { merge: true }).catch(() => {});
  }
  // Also persist locally as fallback
  localStorage.setItem(`sc_profile_${currentUser.uid}`, name);
  showToast('Nombre actualizado ✓');
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function showLoginScreen() {
  document.getElementById('login-screen').classList.add('visible');
  document.getElementById('login-email').focus();
}

function hideLoginScreen() {
  document.getElementById('login-screen').classList.remove('visible');
  clearLoginError();
}

function setLoginLoading(on) {
  document.getElementById('login-btn-text').style.display = on ? 'none' : '';
  document.getElementById('login-spinner').style.display = on ? 'inline-block' : 'none';
  document.getElementById('btn-login').disabled = on;
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function clearLoginError() {
  const el = document.getElementById('login-error');
  el.style.display = 'none';
  el.textContent = '';
}

async function doLogin() {
  if (!auth) { showLoginError('Firebase no está configurado todavía.'); return; }
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  if (!email || !pass) { showLoginError('Ingresá email y contraseña.'); return; }

  clearLoginError();
  setLoginLoading(true);
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    // onAuthStateChanged handles the rest
  } catch (e) {
    setLoginLoading(false);
    const msgs = {
      'auth/invalid-credential':      'Email o contraseña incorrectos.',
      'auth/user-not-found':          'No existe una cuenta con ese email.',
      'auth/wrong-password':          'Contraseña incorrecta.',
      'auth/invalid-email':           'El email no es válido.',
      'auth/too-many-requests':       'Demasiados intentos. Esperá unos minutos.',
      'auth/user-disabled':           'Esta cuenta está deshabilitada.',
      'auth/network-request-failed':  'Error de red. Verificá tu conexión.',
    };
    showLoginError(msgs[e.code] || `Error: ${e.message}`);
  }
}

async function doForgotPassword() {
  if (!auth) return;
  const email = document.getElementById('login-email').value.trim();
  if (!email) {
    showLoginError('Ingresá tu email primero para restablecer la contraseña.');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    document.getElementById('login-forgot').style.display = 'none';
    document.getElementById('reset-sent').style.display = 'flex';
  } catch (e) {
    showLoginError('No se pudo enviar el email. Verificá que el email sea correcto.');
  }
}

async function doLogout() {
  if (!auth) return;
  saveAudit('logout', null, null, `Sesión cerrada`);
  await signOut(auth);
  // onAuthStateChanged handles UI reset
}

function requireAuth() {
  if (!currentUser) { showLoginScreen(); return false; }
  return true;
}

// ─── FIREBASE ─────────────────────────────────────────────────────────────────
function getWeekId(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const wn = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(wn).padStart(2, '0')}`;
}

function getWeekDates(weekId) {
  const [year, wn] = weekId.replace('W', '').split('-').map(Number);
  const jan4 = new Date(year, 0, 4);
  const startOfWeek = new Date(jan4);
  startOfWeek.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7 + (wn - 1) * 7);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 4);
  const fmt = d => d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  return `${fmt(startOfWeek)} – ${fmt(endOfWeek)}`;
}

function getWeekDayDates(weekId) {
  const [year, wn] = weekId.replace('W', '').split('-').map(Number);
  const jan4 = new Date(year, 0, 4);
  const startOfWeek = new Date(jan4);
  startOfWeek.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7 + (wn - 1) * 7);
  const fmt = d => d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  const map = {};
  DAYS.forEach((day, idx) => {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + idx);
    map[day] = fmt(date);
  });
  return map;
}

// ─── FIREBASE CONFIG ──────────────────────────────────────────────────────────
// Lee credenciales desde variables de entorno de Vite (definidas en .env.local)
const ENV_CONFIG = {
  apiKey:      import.meta.env.VITE_FB_API_KEY,
  authDomain:  import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId:   import.meta.env.VITE_FB_PROJECT_ID,
  appId:       import.meta.env.VITE_FB_APP_ID,
};
const HAS_ENV_CONFIG = !!(ENV_CONFIG.apiKey && ENV_CONFIG.projectId);

async function saveConfig() {
  // Si hay env vars, no hace falta el formulario manual
  if (HAS_ENV_CONFIG) {
    await initFirebase(ENV_CONFIG);
    return;
  }
  const cfg = {
    apiKey:     document.getElementById('cfg-apiKey').value.trim(),
    authDomain: document.getElementById('cfg-authDomain').value.trim(),
    projectId:  document.getElementById('cfg-projectId').value.trim(),
    appId:      document.getElementById('cfg-appId').value.trim(),
  };
  if (!cfg.apiKey || !cfg.projectId) {
    showToast('Completá al menos apiKey y projectId');
    return;
  }
  // Guardamos en localStorage solo si el usuario lo ingresó manualmente
  // (nunca las env vars, que son compile-time)
  localStorage.setItem('sc_fb_config', JSON.stringify(cfg));
  await initFirebase(cfg);
}

function useLocalMode() {
  localMode = true;
  document.getElementById('config-banner').classList.add('hidden');
  showToast('Modo local activo — datos guardados en el navegador');
  renderAll();
}

async function initFirebase(cfg) {
  try {
    const app = initializeApp(cfg);
    db   = getFirestore(app);
    auth = getAuth(app);
    document.getElementById('config-banner').classList.add('hidden');

    // onAuthStateChanged is the single source of truth for auth state
    onAuthStateChanged(auth, async (user) => {
      currentUser = user;

      if (user) {
        // Load profile name (Firestore first, localStorage fallback)
        userProfileName = localStorage.getItem(`sc_profile_${user.uid}`) || null;
        await loadUserProfile(user.uid);

        updateUserUI(user);
        hideLoginScreen();
        saveAudit('login', null, null, 'Sesión iniciada');
        await loadWeekFromFirestore();
        renderAll();
        showToast(`Bienvenido, ${getDisplayName(user)} ✓`);

        // First login with no name set → prompt to set one
        if (!getDisplayName(user).includes('@') === false && !userProfileName && !user.displayName) {
          setTimeout(() => openProfileModal(), 800);
        }
      } else {
        userProfileName = null;
        updateUserUI(null);
        showLoginScreen();
        setLoginLoading(false);
      }
    });
  } catch (e) {
    showToast('Error inicializando Firebase: ' + e.message);
  }
}

async function loadWeekFromFirestore() {
  if (!db) return;
  try {
    const snap = await getDoc(doc(db, 'weeks', currentWeek));
    if (snap.exists()) weekData = snap.data();
    const pSnap = await getDocs(collection(db, 'patients'));
    pSnap.forEach(d => { allPatients[d.id] = normalizePatientRecord(d.data()); });
    normalizeAllPatients();
  } catch (e) {
    console.warn('Firestore load:', e);
  }
}

async function saveToFirestore() {
  if (!db) return;
  try {
    await setDoc(doc(db, 'weeks', currentWeek), weekData);
    for (const [hc, p] of Object.entries(allPatients)) {
      await setDoc(doc(db, 'patients', hc), p);
    }
  } catch (e) {
    showToast('Error guardando en Firestore: ' + e.message);
    throw e;
  }
}

function queueWeekAutosave() {
  if (!db) return;
  if (weekAutosaveTimer) clearTimeout(weekAutosaveTimer);
  const weekId = currentWeek;
  const payload = JSON.parse(JSON.stringify(weekData));
  weekAutosaveTimer = setTimeout(async () => {
    try {
      await setDoc(doc(db, 'weeks', weekId), payload);
    } catch (e) {
      console.warn('Autosave week failed:', e);
    }
  }, 500);
}

// ─── WEEK NAV ─────────────────────────────────────────────────────────────────
async function changeWeek(dir) {
  const [y, wn] = currentWeek.replace('W', '').split('-').map(Number);
  const jan4 = new Date(y, 0, 4);
  const startOfWeek = new Date(jan4);
  startOfWeek.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7 + (wn - 1) * 7 + dir * 7);
  currentWeek = getWeekId(startOfWeek);
  weekData = JSON.parse(localStorage.getItem(`sc_week_${currentWeek}`) || '{}');
  await loadWeekFromFirestore();
  renderAll();
}

function updateWeekLabel() {
  const dates = getWeekDates(currentWeek);
  const shortId = currentWeek.replace('-', ' ');
  document.getElementById('week-label').innerHTML = `${shortId} <span class="week-dates">· ${dates}</span>`;
}

// ─── FLOOR TABS ───────────────────────────────────────────────────────────────
function getPatientCountForFloor(f) {
  return Object.values(allPatients).filter(p => {
    return isPatientActive(p) &&
           (p.floor || '').toLowerCase() === f.toLowerCase();
  }).length;
}


function renderFloorTabs() {
  const el = document.getElementById('floor-tabs');
  el.innerHTML = FLOORS.map(f => {
    const count = getPatientCountForFloor(f);
    const countBadge = count > 0 ? `<span style="background:rgba(255,255,255,0.25);border-radius:10px;padding:0 5px;font-size:10px;margin-left:4px;">${count}</span>` : '';
    return `<button class="floor-tab ${f === currentFloor ? 'active' : ''}" data-floor="${f}">${FLOOR_LABELS[f] || f}${countBadge}</button>`;
  }).join('');

  // Wire up click listeners every time tabs are re-rendered
  el.querySelectorAll('.floor-tab').forEach(btn => {
    btn.addEventListener('click', () => selectFloor(btn.dataset.floor));
  });
}

function selectFloor(f) {
  currentFloor = f;
  renderTable();
  renderFloorTabs();
}

// ─── PATIENTS TABLE ───────────────────────────────────────────────────────────
function getFloorPatients() {
  const knownBeds = BED_STRUCTURE[currentFloor] || [];
  // Map cama → patient for this floor
  const byBed = {};
  Object.values(allPatients).forEach(p => {
    if (isPatientActive(p) &&
        (p.floor || '').toLowerCase() === currentFloor.toLowerCase()) {
      byBed[p.cama] = p;
    }
  });
  // Canonical bed order first, then any extras at the end
  const ordered = knownBeds.filter(c => byBed[c]).map(c => byBed[c]);
  const extra   = Object.values(byBed)
    .filter(p => !knownBeds.includes(p.cama))
    .sort((a, b) => String(a.cama).localeCompare(String(b.cama)));
  return [...ordered, ...extra];
}

function renderTable(filter = '') {
  const patients = getFloorPatients().filter(p =>
    !filter || p.paciente.toLowerCase().includes(filter.toLowerCase())
  );
  document.getElementById('floor-title').textContent = FLOOR_LABELS[currentFloor] || currentFloor;
  document.getElementById('patient-count').textContent = `${patients.length} paciente${patients.length !== 1 ? 's' : ''}`;

  const noPatients = document.getElementById('no-patients');
  if (!patients.length) {
    document.getElementById('patient-tbody').innerHTML = '';
    document.getElementById('mobile-card-list').innerHTML = '';
    noPatients.style.display = 'block';
    return;
  }
  noPatients.style.display = 'none';

  // Desktop table
  document.getElementById('patient-tbody').innerHTML = patients.map(p => {
    const hc = String(p.hc);
    return `
      <tr class="patient-row" data-hc="${hc}" style="cursor:pointer">
        <td><div class="cell-room">${p.cama}</div></td>
        <td>
          <div class="cell-patient-name">${p.paciente}</div>
          <div class="cell-sub">HC ${p.hc}${p.ingreso ? ' · Ing. ' + p.ingreso : ''}</div>
        </td>
        <td>
          <div style="font-size:12px;color:var(--text2)">${p.medico || '—'}</div>
          <div class="cell-sub">${(p.cobertura || '').split(' - ')[0]}</div>
        </td>
        <td><span class="cell-diag">${p.diagnostico || '—'}</span></td>
        <td style="text-align:right;padding-right:16px;" class="btn-action-td">
          <button class="btn discharge-btn" data-hc="${hc}" title="Dar de alta" style="padding:4px 10px;font-size:11px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Alta
          </button>
        </td>
      </tr>
      <tr class="days-row" id="days-row-${hc}" style="display:none;">
        <td colspan="5" style="padding:0;background:var(--surface2);">
          <div class="days-row-content" id="days-content-${hc}"></div>
        </td>
      </tr>`;
  }).join('');

  // Mobile cards
  document.getElementById('mobile-card-list').innerHTML = patients.map(p => {
    const hc = String(p.hc);
    const hasSomeData = DAYS.some(d => {
      const entry = weekData[`${hc}_${d}`];
      return entry && CATS.some(c => entry[c.id] && (entry[c.id].tags?.length || entry[c.id].text));
    });
    return `
      <div class="mobile-card" data-hc="${hc}">
        <div class="mobile-card-top">
          <div class="cell-room" style="font-size:14px;min-width:42px">${p.cama}</div>
          <div style="flex:1;min-width:0;">
            <div class="cell-patient-name" style="font-size:13px;">${p.paciente}</div>
            <div class="cell-sub">HC ${p.hc}${p.ingreso ? ' · Ing. ' + p.ingreso : ''}</div>
          </div>
          <button class="btn mobile-discharge-btn" data-hc="${hc}" style="padding:4px 8px;font-size:10px;flex-shrink:0;gap:3px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Alta
          </button>
        </div>
        ${hasSomeData ? `<div class="mobile-card-days">${DAYS.map(d => {
      const entry = weekData[`${hc}_${d}`];
      const cats = CATS.filter(c => entry?.[c.id] && (entry[c.id].tags?.length || entry[c.id].text));
      const hasData = cats.length > 0;
      return `<span class="mobile-day-pill ${hasData ? 'has-data' : ''}" data-hc="${hc}" data-day="${d}">
                  ${DAY_LABELS[d]}${hasData ? ` <span style="color:var(--text3);font-size:9px">(${cats.length})</span>` : ''}
                </span>`;
    }).join('')}</div>` : `<div class="mobile-card-hint">Tocá para cargar medicación →</div>`}
        <div class="mobile-card-diag">${p.diagnostico || ''}</div>
      </div>`;
  }).join('');

  // Attach event listeners
  document.querySelectorAll('.patient-row').forEach(row => {
    const hc = row.dataset.hc;
    row.addEventListener('click', () => handlePatientRowClick(hc));
  });
  document.querySelectorAll('.discharge-btn').forEach(btn => {
    const hc = btn.dataset.hc;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dischargePatient(hc);
    });
  });
  document.querySelectorAll('.mobile-card').forEach(card => {
    const hc = card.dataset.hc;
    card.addEventListener('click', () => handlePatientRowClick(hc));
  });
  document.querySelectorAll('.mobile-discharge-btn').forEach(btn => {
    const hc = btn.dataset.hc;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dischargePatient(hc);
    });
  });
  document.querySelectorAll('.mobile-day-pill').forEach(pill => {
    const hc = pill.dataset.hc;
    const day = pill.dataset.day;
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      openPanel(hc, day);
    });
  });
}

function hasData(hc, day) {
  const entry = weekData[`${hc}_${day}`];
  if (!entry) return false;
  return CATS.some(c => entry[c.id] && (entry[c.id].text || entry[c.id].tags?.length));
}

function renderDayBadges(hc, day) {
  const entry = weekData[`${hc}_${day}`];
  if (!entry) return `<div class="cell-empty">+</div>`;
  const badges = CATS.filter(c => {
    const d = entry[c.id];
    return d && (d.text || d.tags?.length);
  }).map(c => `<span class="badge ${c.cls}">${c.label.substring(0, 3).toUpperCase()}</span>`).join('');
  return badges || `<div class="cell-empty">+</div>`;
}

function toggleDaysRow(hc) {
  const row = document.getElementById(`days-row-${hc}`);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  document.querySelectorAll('.days-row').forEach(r => { r.style.display = 'none'; });
  currentDaysHc = null;
  if (isOpen) return;
  currentDaysHc = hc;
  row.style.display = 'table-row';
  renderDaysRowContent(hc);
}

function renderDaysRowContent(hc) {
  const container = document.getElementById(`days-content-${hc}`);
  if (!container) return;
  const p = allPatients[hc];
  const dayDates = getWeekDayDates(currentWeek);
  const dayCards = DAYS.map(day => {
    const entry = weekData[`${hc}_${day}`];
    const hasEntry = entry && CATS.some(c => entry[c.id] && (entry[c.id].text || entry[c.id].tags?.length));
    let summary = 'Sin datos';
    if (hasEntry) {
      const parts = [];
      CATS.forEach(c => {
        const d = entry[c.id];
        if (!d) return;
        if (d.tags?.length) parts.push(`<span style="color:${c.dot};font-size:9px;font-weight:600">${c.label}:</span> ${d.tags.join(', ')}`);
        else if (d.text) parts.push(`<span style="color:${c.dot};font-size:9px;font-weight:600">${c.label}:</span> ${d.text.substring(0, 60)}`);
      });
      if (entry._lastModifiedBy) {
        const modifiedDate = entry._lastModifiedAt ? new Date(entry._lastModifiedAt).toLocaleDateString() : '';
        parts.push(`<span style="font-size:8px;color:var(--text3);border-top:1px solid var(--border);margin-top:4px;padding-top:4px;">✎ ${entry._lastModifiedBy}${modifiedDate ? ' · ' + modifiedDate : ''}</span>`);
      }
      summary = parts.join('<br>');
    }
    return `
      <button class="days-row-card ${hasEntry ? 'has-data' : ''}" data-hc="${hc}" data-day="${day}">
        <div class="days-row-card-header">
          <span class="days-row-day">${DAY_LABELS[day]} <small style="font-size:10px;color:var(--text3);font-weight:500;">${dayDates[day]}</small></span>
          <div class="day-badges">${renderDayBadges(hc, day)}</div>
        </div>
        <div class="days-row-summary">${summary}</div>
      </button>`;
  }).join('');
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px 4px;border-bottom:1px solid var(--border);background:var(--surface);">
      <span style="font-size:11px;color:var(--text3);">
        Semana <strong style="color:var(--text2)">${currentWeek}</strong>
        ${hasPrevWeekData(hc) ? `<button class="btn copy-prev-week-btn" data-hc="${hc}" style="margin-left:10px;padding:2px 8px;font-size:10px;">↩ Copiar semana anterior</button>` : ''}
      </span>
      <button class="btn move-patient-btn" data-hc="${hc}" style="padding:3px 10px;font-size:11px;gap:4px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M5 9l7-7 7 7M5 15l7 7 7-7"/></svg>
        Mover cama
      </button>
    </div>
    <div class="days-row-cards-grid">${dayCards}</div>`;

  // Attach event listeners
  container.querySelectorAll('.days-row-card').forEach(card => {
    const hc = card.dataset.hc;
    const day = card.dataset.day;
    card.addEventListener('click', () => openPanel(hc, day));
  });
  container.querySelectorAll('.copy-prev-week-btn').forEach(btn => {
    const hc = btn.dataset.hc;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copiarSemanaAnterior(hc);
    });
  });
  container.querySelectorAll('.move-patient-btn').forEach(btn => {
    const hc = btn.dataset.hc;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMovePatient(hc);
    });
  });
}

// ─── ENTRY PANEL ──────────────────────────────────────────────────────────────
function openPanel(hc, day) {
  if (!requireAuth()) return;
  const p = allPatients[hc];
  if (!p) return;
  if (document.getElementById('patient-days-overlay').classList.contains('open')) {
    document.getElementById('patient-days-panel').classList.remove('open');
    document.getElementById('patient-days-overlay').classList.remove('open');
  }
  panelState.hc = hc;
  panelState.day = day;
  panelState.data = JSON.parse(JSON.stringify(weekData[`${hc}_${day}`] || {}));
  document.getElementById('panel-patient-name').textContent = p.paciente;
  document.getElementById('panel-meta').textContent = `Cama ${p.cama} · HC ${p.hc} · ${p.medico || ''}`;
  renderDaySelector();
  renderPanelBody();
  document.getElementById('entry-overlay').classList.add('open');
  document.getElementById('entry-panel').classList.add('open');
}

function renderDaySelector() {
  const el = document.getElementById('day-selector');
  const dayDates = getWeekDayDates(currentWeek);
  el.innerHTML = DAYS.map(d =>
    `<button class="day-btn ${d === panelState.day ? 'active' : ''}" data-day="${d}">
      ${DAY_LABELS[d]}
      <span class="day-date">${dayDates[d]}</span>
    </button>`
  ).join('');
  document.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPanelDay(btn.dataset.day));
  });
  updateCopyPrevBtn();
}

function updateCopyPrevBtn() {
  const btn = document.getElementById('btn-copy-prev');
  const label = document.getElementById('btn-copy-prev-label');
  const idx = DAYS.indexOf(panelState.day);
  if (idx === 0) {
    btn.disabled = true;
    btn.title = 'No hay día anterior (es Lunes)';
    btn.style.opacity = '0.4';
    btn.style.cursor = 'not-allowed';
    if (label) label.textContent = 'Copiar desde día anterior';
  } else {
    btn.disabled = false;
    btn.title = `Copia los datos del ${DAY_LABELS[DAYS[idx - 1]]} al día actual`;
    btn.style.opacity = '';
    btn.style.cursor = '';
    if (label) label.textContent = `Copiar desde ${DAY_LABELS[DAYS[idx - 1]]}`;
  }
}

function switchPanelDay(day) {
  collectPanelData();
  const currentKey = `${panelState.hc}_${panelState.day}`;
  weekData[currentKey] = panelState.data;
  localStorage.setItem(`sc_week_${currentWeek}`, JSON.stringify(weekData));
  queueWeekAutosave();
  panelState.day = day;
  panelState.data = JSON.parse(JSON.stringify(weekData[`${panelState.hc}_${day}`] || {}));
  renderDaySelector();
  renderPanelBody();
  showToast(`Cambiado a ${DAY_LABELS[day]} – cambios guardados`);
}

function renderPanelBody() {
  const el = document.getElementById('panel-body');
  el.innerHTML = CATS.map(cat => {
    const entry = panelState.data[cat.id] || {};
    const activeTags = entry.tags || [];
    const text = entry.text || '';
    const tags = TAGS[cat.id] || [];
    const summary = activeTags.length ? activeTags.join(', ') : (text ? text.substring(0, 40) : '');
    return `
      <div class="cat-section" data-cat="${cat.id}">
        <div class="cat-header" data-cat="${cat.id}">
          <div class="cat-dot" style="background:${cat.dot}"></div>
          <span class="cat-label" style="color:${cat.dot}">${cat.label}</span>
          <span class="cat-summary" id="cat-sum-${cat.id}">${summary}</span>
          <span class="cat-toggle">${(activeTags.length || text) ? '▴' : '▾'}</span>
        </div>
        <div class="cat-body" id="cat-body-${cat.id}" style="${activeTags.length || text ? '' : 'display:none'}">
          <div class="tags-row">
            ${tags.map(t => `
              <button class="tag-chip ${cat.cls} ${activeTags.includes(t) ? 'active' : ''}" data-cat="${cat.id}" data-tag="${t.replace(/'/g, "\\'")}">
                ${t}
              </button>`).join('')}
          </div>
          <textarea class="cat-textarea" id="ta-${cat.id}" data-cat="${cat.id}"
                    placeholder="Notas adicionales de ${cat.label.toLowerCase()}...">${text}</textarea>
        </div>
      </div>`;
  }).join('');

  // Attach event listeners
  document.querySelectorAll('.cat-header').forEach(header => {
    const catId = header.dataset.cat;
    header.addEventListener('click', () => toggleCat(catId));
  });
  document.querySelectorAll('.tag-chip').forEach(btn => {
    const catId = btn.dataset.cat;
    const tag = btn.dataset.tag;
    btn.addEventListener('click', () => toggleTag(catId, tag, btn));
  });
  document.querySelectorAll('.cat-textarea').forEach(ta => {
    const catId = ta.dataset.cat;
    ta.addEventListener('input', () => updateCatSummary(catId));
  });
}

function toggleCat(catId) {
  const body = document.getElementById(`cat-body-${catId}`);
  if (!body) return;
  const section = body.closest('.cat-section');
  const toggle = section?.querySelector('.cat-toggle');
  const isOpen = body.style.display !== 'none';
  const panelBody = document.getElementById('panel-body');

  if (isOpen) {
    body.style.display = 'none';
    if (toggle) toggle.textContent = '▾';
  } else {
    // UX: keep only one expanded category to avoid the panel growing too tall.
    document.querySelectorAll('.cat-body').forEach(otherBody => {
      if (otherBody.id === body.id) return;
      otherBody.style.display = 'none';
      const otherSection = otherBody.closest('.cat-section');
      const otherToggle = otherSection?.querySelector('.cat-toggle');
      if (otherToggle) otherToggle.textContent = '▾';
    });

    body.style.display = '';
    if (toggle) toggle.textContent = '▴';

    // Controlled scroll inside panel body to avoid abrupt viewport jumps.
    if (section && panelBody) {
      requestAnimationFrame(() => {
        const panelRect = panelBody.getBoundingClientRect();
        const sectionRect = section.getBoundingClientRect();
        const topGap = 12;
        const bottomGap = 18;
        const isAbove = sectionRect.top < panelRect.top + topGap;
        const isBelow = sectionRect.bottom > panelRect.bottom - bottomGap;

        if (isAbove || isBelow) {
          const delta = isAbove
            ? sectionRect.top - panelRect.top - topGap
            : sectionRect.bottom - panelRect.bottom + bottomGap;
          panelBody.scrollBy({ top: delta, behavior: 'smooth' });
        }
      });
    }
  }
}

function toggleTag(catId, tag, btn) {
  if (!panelState.data[catId]) panelState.data[catId] = { tags: [], text: '' };

  const tags = panelState.data[catId].tags || [];
  const textarea = document.getElementById(`ta-${catId}`);
  let currentText = textarea ? textarea.value : panelState.data[catId].text || '';

  const idx = tags.indexOf(tag);

  if (idx >= 0) {
    tags.splice(idx, 1);
    btn.classList.remove('active');
    const tagLines = currentText.split('\n').filter(line => line.trim() !== tag);
    currentText = tagLines.join('\n');
  } else {
    tags.push(tag);
    btn.classList.add('active');
    if (currentText.trim()) {
      currentText = currentText + '\n' + tag;
    } else {
      currentText = tag;
    }
  }

  panelState.data[catId].tags = tags;
  panelState.data[catId].text = currentText;

  if (textarea) textarea.value = currentText;
  updateCatSummary(catId);

  const body = document.getElementById(`cat-body-${catId}`);
  if (body && body.style.display === 'none') body.style.display = '';
}

function updateCatSummary(catId) {
  const entry = panelState.data[catId] || {};
  const tags = entry.tags || [];
  const ta = document.getElementById(`ta-${catId}`);
  const text = ta ? ta.value : '';
  const sum = document.getElementById(`cat-sum-${catId}`);
  if (sum) sum.textContent = tags.length ? tags.join(', ') : text.substring(0, 40);
}

function collectPanelData() {
  CATS.forEach(cat => {
    const ta = document.getElementById(`ta-${cat.id}`);
    if (!ta) return;
    if (!panelState.data[cat.id]) panelState.data[cat.id] = { tags: [], text: '' };
    panelState.data[cat.id].text = ta.value;
  });
}

function saveEntry() {
  if (!requireAuth()) return;
  collectPanelData();
  const key = `${panelState.hc}_${panelState.day}`;
  const wasExisting = !!weekData[key];

  panelState.data._lastModifiedBy = getDisplayName(currentUser);
  panelState.data._lastModifiedAt = new Date().toISOString();
  panelState.data._lastWeek = currentWeek;

  weekData[key] = panelState.data;
  localStorage.setItem(`sc_week_${currentWeek}`, JSON.stringify(weekData));
  queueWeekAutosave();

  const details = {};
  CATS.forEach(cat => {
    const d = panelState.data[cat.id];
    if (d && (d.tags?.length || d.text)) {
      details[cat.id] = { tags: d.tags, textPreview: d.text?.substring(0, 50) };
    }
  });
  saveAudit(wasExisting ? 'modify' : 'create', panelState.hc, panelState.day, details);

  const savedHc = panelState.hc;
  closePanel();
  renderTable(document.getElementById('search-input').value);

  if (window.innerWidth <= 640) {
    openPatientDays(savedHc);
  } else if (currentDaysHc) {
    const row = document.getElementById(`days-row-${currentDaysHc}`);
    if (row) {
      currentDaysHc = savedHc;
      row.style.display = 'table-row';
      renderDaysRowContent(savedHc);
    }
  }
  showToast('Entrada guardada ✓');
}

function copyToPrevDay() {
  if (!requireAuth()) return;
  const idx = DAYS.indexOf(panelState.day);
  if (idx <= 0) {
    showToast('No hay día anterior para copiar (es Lunes)');
    return;
  }
  const prevDay = DAYS[idx - 1];
  const prevKey = `${panelState.hc}_${prevDay}`;
  const prevData = weekData[prevKey];
  const hasPrevData = prevData && CATS.some(c => prevData[c.id] && (prevData[c.id].text || prevData[c.id].tags?.length));
  if (!hasPrevData) {
    showToast(`El ${DAY_LABELS[prevDay]} no tiene datos para copiar`);
    return;
  }
  const doCopy = () => {
    panelState.data = JSON.parse(JSON.stringify(prevData));
    const currentKey = `${panelState.hc}_${panelState.day}`;
    weekData[currentKey] = panelState.data;
    localStorage.setItem(`sc_week_${currentWeek}`, JSON.stringify(weekData));
    queueWeekAutosave();
    renderPanelBody();
    updateCatSummariesFromData();
    showToast(`Datos copiados desde ${DAY_LABELS[prevDay]} → ${DAY_LABELS[panelState.day]}`);
  };
  const currentHasData = CATS.some(c => panelState.data[c.id] && (panelState.data[c.id].text || panelState.data[c.id].tags?.length));
  if (currentHasData) {
    showOverwriteConfirm(panelState.day, doCopy);
  } else {
    doCopy();
  }
}

function updateCatSummariesFromData() {
  CATS.forEach(cat => {
    const entry = panelState.data[cat.id] || {};
    const tags = entry.tags || [];
    const text = entry.text || '';
    const summary = tags.length ? tags.join(', ') : (text ? text.substring(0, 40) : '');
    const sumEl = document.getElementById(`cat-sum-${cat.id}`);
    if (sumEl) sumEl.textContent = summary;
    const ta = document.getElementById(`ta-${cat.id}`);
    if (ta) ta.value = text || '';
    const tagContainer = document.getElementById(`cat-body-${cat.id}`)?.querySelector('.tags-row');
    if (tagContainer) {
      tagContainer.querySelectorAll('.tag-chip').forEach(btn => {
        const tagText = btn.dataset.tag;
        if (tags.includes(tagText)) btn.classList.add('active');
        else btn.classList.remove('active');
      });
    }
  });
}

function showOverwriteConfirm(prevDay, onConfirm) {
  const footer = document.querySelector('#entry-panel .panel-footer');
  const originalHTML = footer.innerHTML;
  footer.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;width:100%;">
      <div style="font-size:12px;color:var(--cat-atb);display:flex;align-items:center;gap:6px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        El día actual ya tiene datos. ¿Sobreescribir?
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn" id="cancel-overwrite" style="font-size:11px;padding:5px 10px;">Cancelar</button>
        <button class="btn primary" id="confirm-overwrite" style="font-size:11px;padding:5px 10px;background:var(--cat-atb);border-color:var(--cat-atb);">
          Sí, sobreescribir
        </button>
      </div>
    </div>`;
  window._panelFooterOriginal = originalHTML;
  document.getElementById('cancel-overwrite').onclick = () => restorePanelFooter();
  document.getElementById('confirm-overwrite').onclick = () => {
    restorePanelFooter();
    onConfirm();
  };
}

function restorePanelFooter() {
  const footer = document.querySelector('#entry-panel .panel-footer');
  if (window._panelFooterOriginal) {
    footer.innerHTML = window._panelFooterOriginal;
    window._panelFooterOriginal = null;
    updateCopyPrevBtn();
    // Reattach event listeners
    document.getElementById('panel-cancel').onclick = () => closePanel();
    document.getElementById('btn-copy-prev').onclick = () => copyToPrevDay();
    document.getElementById('panel-save').onclick = () => saveEntry();
  }
}

function closePanel() {
  document.getElementById('entry-overlay').classList.remove('open');
  document.getElementById('entry-panel').classList.remove('open');
}

// ─── CSV IMPORT ───────────────────────────────────────────────────────────────
function openCSV() {
  document.getElementById('csv-overlay').classList.add('open');
}

function closeCSV() {
  document.getElementById('csv-overlay').classList.remove('open');
  pendingCSV = [];
  document.getElementById('csv-preview').style.display = 'none';
  document.getElementById('btn-import').disabled = true;
}

function parseCSV(text) {
  const lines = text.split('\n');
  const parsedPatients = [];

  for (let line of lines) {
    if (!line.trim()) continue;

    // Regex para manejar valores entre comillas correctamente separados por comas
    const regex = /(".*?"|[^",\s]+)(?=\s*,|\s*$)/g;
    let tokens = line.match(regex);
    
    if (!tokens) continue;

    // Limpiamos las comillas extra de los tokens
    tokens = tokens.map(t => t.replace(/^"|"$/g, '').trim());

    // Buscamos si la línea tiene el patrón de datos 
    const isHeaderRow = tokens[0] === 'Listado de Internaciones';
    if (!isHeaderRow) continue;
    
    // Verificamos que tenga los campos mínimos necesarios
    if (tokens.length >= 20) {
      const agrupacion = tokens[8] || '';        // Sector/Agrupación
      const cama = tokens[18] || '';
      const paciente = tokens[19] || '';
      const hc = tokens[20] || '';
      const medico = tokens[21] || '';
      const ingreso = tokens[22] || '';
      const cobertura = tokens[24] || '';
      const servicio = tokens[25] || '';
      const diagnostico = tokens[26] || '';

      // CORREGIDO: orden correcto de parámetros: (cama, agrupacionHint)
      const floorId = detectFloor(cama, agrupacion);

      // Solo incluimos si es un piso válido y tenemos datos mínimos
      if (floorId && hc && paciente && cama && cama !== 'Cama' && cama !== 'cama') {
        parsedPatients.push({
          hc: String(hc),
          cama: String(cama),
          paciente: String(paciente),
          medico: String(medico || '—'),
          ingreso: ingreso.split(' ')[0],
          cobertura: String(cobertura || '—'),
          servicio: String(servicio || '—'),
          diagnostico: String(diagnostico || 'SIN DIAGNÓSTICO'),
          floor: floorId
        });
      }
    }
  }

  // Filtrar posibles duplicados por número de HC
  const uniquePatients = {};
  for (const p of parsedPatients) {
    if (!uniquePatients[p.hc] || uniquePatients[p.hc].cama !== p.cama) {
      uniquePatients[p.hc] = p;
    }
  }

  const result = Object.values(uniquePatients);
  console.log('Pacientes parseados:', result.length, result.map(p => ({cama: p.cama, floor: p.floor, paciente: p.paciente})));
  return result;
}

function showCSVPreview(patients) {
  const el = document.getElementById('csv-preview');
  if (!patients.length) {
    el.style.display = 'none';
    document.getElementById('csv-archive-summary').style.display = 'none';
    showToast('No se encontraron pacientes');
    return;
  }

  // Calculate who would be archived (active patients absent from new CSV)
  const incomingHCs = new Set(patients.map(p => String(p.hc)));
  const toArchive = Object.values(allPatients).filter(p =>
    isPatientActive(p) && !incomingHCs.has(String(p.hc))
  );
  showArchiveSummary(toArchive);

  const byFloor = {};
  patients.forEach(p => { byFloor[p.floor] = (byFloor[p.floor] || 0) + 1; });
  const floorSummary = Object.entries(byFloor)
    .filter(([f]) => f && FLOOR_LABELS[f])
    .map(([f, n]) => `${FLOOR_LABELS[f]}: ${n}`)
    .join(' · ');

  el.style.display = 'flex';
  el.innerHTML = `
    <div class="preview-info">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <span>${patients.length} pacientes · ${floorSummary || `${new Set(patients.map(p => p.floor)).size} sectores`}</span>
    </div>
    <div class="preview-list">
      ${patients.map(p => `
        <div class="preview-row">
          <span class="pr-room">${p.cama}</span>
          <span class="pr-name">${p.paciente}</span>
          <span class="pr-doc">${p.medico}</span>
        </div>`).join('')}
    </div>`;
  document.getElementById('btn-import').disabled = false;
}

function importPatients() {
  if (!pendingCSV.length) return;

  const incomingHCs = new Set(pendingCSV.map(p => String(p.hc)));
  const archivedPatients = [];

  // Archive active patients NOT in the new CSV
  for (const [hc, p] of Object.entries(allPatients)) {
    if (isPatientActive(p) && !incomingHCs.has(String(hc))) {
      allPatients[hc] = {
        ...p,
        status: PATIENT_STATUS.ARCHIVED,
        archivedAt: new Date().toISOString(),
        archivedReason: 'csv_import',
        archivedBy: getDisplayName(currentUser),
      };
      archivedPatients.push(p);
    }
  }

  // Upsert incoming patients
  for (const p of pendingCSV) {
    const existing = allPatients[p.hc];
    p.status = PATIENT_STATUS.ACTIVE;
    delete p.archivedAt;
    delete p.archivedReason;
    delete p.archivedBy;
    // Preserve week data link if patient already existed
    if (existing) p.createdAt = existing.createdAt;
    allPatients[p.hc] = p;
  }

  localStorage.setItem('sc_patients', JSON.stringify(allPatients));

  if (db) {
    for (const [hc, p] of Object.entries(allPatients)) {
      setDoc(doc(db, 'patients', hc), p).catch(() => {});
    }
  }

  saveAudit('csv_import', null, null, {
    imported: pendingCSV.length,
    archived: archivedPatients.length,
    archivedNames: archivedPatients.map(p => p.paciente),
  });

  closeCSV();
  renderTable();
  renderFloorTabs();

  const archiveMsg = archivedPatients.length
    ? ` · ${archivedPatients.length} archivado${archivedPatients.length !== 1 ? 's' : ''}`
    : '';
  showToast(`${pendingCSV.length} pacientes importados${archiveMsg} ✓`);
  pendingCSV = [];
}

function showArchiveSummary(toArchive) {
  const el = document.getElementById('csv-archive-summary');
  if (!toArchive.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = `
    <div style="background:rgba(245,166,35,0.1);border:1px solid rgba(245,166,35,0.3);border-radius:7px;padding:10px 12px;">
      <div style="font-size:11px;font-weight:600;color:var(--cat-atb);margin-bottom:6px;">
        ⚠ ${toArchive.length} paciente${toArchive.length !== 1 ? 's' : ''} no aparece${toArchive.length === 1 ? '' : 'n'} en el nuevo CSV y será${toArchive.length !== 1 ? 'n' : ''} archivado${toArchive.length !== 1 ? 's' : ''}:
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;max-height:100px;overflow-y:auto;">
        ${toArchive.map(p => `
          <div style="font-size:11px;color:var(--text2);display:flex;gap:8px;">
            <span style="color:var(--accent);font-family:var(--mono);min-width:35px">${p.cama}</span>
            <span>${p.paciente}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

function readCSVFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    pendingCSV = parseCSV(text);
    showCSVPreview(pendingCSV);
  };
  reader.readAsText(file, 'latin1');
}

function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.add('drag-over');
}

function handleDragLeave() {
  document.getElementById('drop-zone').classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drag-over');
  readCSVFile(e.dataTransfer.files[0]);
}

function handleFileInput(input) {
  if (input.files[0]) readCSVFile(input.files[0]);
}

// ─── HISTORY VIEW (CONSULTA FIRESTORE) ────────────────────────────────────────
let historyMode = 'lastweek';      // 'lastweek' o 'search'
let historyCurrentPage = 0;
let historyTotalResults = 0;
let historyLastDoc = null;          // Para paginación de Firestore
let historySearchParams = null;     // Cache de la última búsqueda

const HISTORY_PAGE_SIZE = 20;       // Resultados por página

function toggleView(view) {
  document.getElementById('view-main').style.display = view === 'main' ? 'block' : 'none';
  document.getElementById('view-history').style.display = view === 'history' ? 'block' : 'none';
  if (view === 'history') {
    if (historyMode === 'lastweek') {
      loadLastWeekFromFirestore();
    } else {
      document.getElementById('history-results').innerHTML = '<div class="no-data" style="text-align:center; padding:40px;"><p>🔍 Completá los filtros y presioná "Buscar" para consultar Firestore.</p></div>';
      document.getElementById('history-pagination').style.display = 'none';
    }
  }
}

// Cargar la última semana desde Firestore
async function loadLastWeekFromFirestore() {
  if (!db) {
    showToast('Firestore no está configurado. Conectá Firebase primero.');
    return;
  }
  
  const loading = document.getElementById('history-loading');
  const resultsDiv = document.getElementById('history-results');
  
  loading.style.display = 'block';
  resultsDiv.innerHTML = '';
  
  try {
    // Obtener todas las semanas disponibles desde Firestore
    const weeksSnapshot = await getDocs(collection(db, 'weeks'));
    if (weeksSnapshot.empty) {
      loading.style.display = 'none';
      resultsDiv.innerHTML = '<div class="no-data"><p>📭 No hay datos en Firestore aún.</p><p style="font-size:12px; margin-top:8px;">Comenzá a cargar medicación para los pacientes.</p></div>';
      return;
    }
    
    // Ordenar semanas por ID descendente (la más reciente primero)
    const weeks = [];
    weeksSnapshot.forEach(doc => {
      weeks.push({ id: doc.id, data: doc.data() });
    });
    weeks.sort((a, b) => b.id.localeCompare(a.id));
    
    const lastWeekId = weeks[0].id;
    const lastWeekData = weeks[0].data;
    
    loading.style.display = 'none';
    
    // Procesar y mostrar los datos
    const results = await processWeekData(lastWeekId, lastWeekData);
    renderHistoryResults(results, `📅 Última semana con datos: ${lastWeekId} · ${getWeekDates(lastWeekId)}`);
    
  } catch (error) {
    console.error('Error loading last week:', error);
    loading.style.display = 'none';
    resultsDiv.innerHTML = `<div class="no-data"><p>❌ Error al cargar datos: ${error.message}</p></div>`;
    showToast('Error al consultar Firestore');
  }
}

// Procesar los datos de una semana
async function processWeekData(weekId, weekData) {
  const results = [];
  
  for (const [key, dayData] of Object.entries(weekData)) {
    const parts = key.split('_');
    const hc = parts[0];
    const day = parts[1];
    if (!day || !DAYS.includes(day)) continue;
    
    // Buscar el paciente en Firestore
    let patientInfo = null;
    let isDischarged = false;
    
    try {
      // Primero buscar en pacientes activos
      const patientDoc = await getDoc(doc(db, 'patients', String(hc)));
      if (patientDoc.exists()) {
        patientInfo = patientDoc.data();
        patientInfo.hc = hc;
        isDischarged = patientInfo.status === 'archived';
      } else {
        // Buscar en discharges
        const dischargesSnapshot = await getDocs(collection(db, 'discharges'));
        for (const dischargeDoc of dischargesSnapshot.docs) {
          const discharge = dischargeDoc.data();
          if (String(discharge.hc) === String(hc)) {
            patientInfo = discharge;
            isDischarged = true;
            break;
          }
        }
      }
    } catch (e) {
      console.warn(`Error fetching patient ${hc}:`, e);
      continue;
    }
    
    if (!patientInfo) continue;
    
    results.push({
      wid: weekId,
      day,
      patient: patientInfo,
      hc,
      dayData,
      isDischarged,
      cama: patientInfo.cama || patientInfo.camaAnterior || '—'
    });
  }
  
  // Ordenar por cama
  results.sort((a, b) => String(a.cama).localeCompare(String(b.cama)));
  return results;
}

// Búsqueda avanzada en Firestore
async function executeFirestoreSearch() {
  if (!db) {
    showToast('Firestore no está configurado. Conectá Firebase primero.');
    return;
  }
  
  const patientQuery = document.getElementById('hist-search-patient').value.trim();
  const drugQuery = document.getElementById('hist-search-drug').value.trim();
  const weekQuery = document.getElementById('hist-search-week').value;
  
  const loading = document.getElementById('history-loading');
  const resultsDiv = document.getElementById('history-results');
  const paginationDiv = document.getElementById('history-pagination');
  
  loading.style.display = 'block';
  resultsDiv.innerHTML = '';
  paginationDiv.style.display = 'none';
  
  // Guardar parámetros para paginación
  historySearchParams = { patientQuery, drugQuery, weekQuery };
  historyCurrentPage = 0;
  historyLastDoc = null;
  
  try {
    // Obtener todas las semanas (o una específica si se filtró)
    let weeksQuery;
    if (weekQuery) {
      // Buscar una semana específica
      const weekDoc = await getDoc(doc(db, 'weeks', weekQuery));
      if (weekDoc.exists()) {
        const results = await filterWeekData(weekQuery, weekDoc.data(), patientQuery, drugQuery);
        renderHistoryResults(results, `🔍 Resultados para semana: ${weekQuery}`);
      } else {
        loading.style.display = 'none';
        resultsDiv.innerHTML = '<div class="no-data"><p>📭 No se encontró la semana especificada.</p></div>';
      }
    } else {
      // Buscar en todas las semanas (usando paginación)
      await loadMoreFirestoreResults();
    }
  } catch (error) {
    console.error('Search error:', error);
    loading.style.display = 'none';
    resultsDiv.innerHTML = `<div class="no-data"><p>❌ Error en la búsqueda: ${error.message}</p></div>`;
    showToast('Error al consultar Firestore');
  }
}

// Filtrar datos de una semana específica
async function filterWeekData(weekId, weekData, patientQuery, drugQuery) {
  const results = [];
  
  for (const [key, dayData] of Object.entries(weekData)) {
    const parts = key.split('_');
    const hc = parts[0];
    const day = parts[1];
    if (!day || !DAYS.includes(day)) continue;
    
    // Obtener paciente
    let patientInfo = null;
    let isDischarged = false;
    
    try {
      const patientDoc = await getDoc(doc(db, 'patients', String(hc)));
      if (patientDoc.exists()) {
        patientInfo = patientDoc.data();
        patientInfo.hc = hc;
        isDischarged = patientInfo.status === 'archived';
      } else {
        const dischargesSnapshot = await getDocs(collection(db, 'discharges'));
        for (const dischargeDoc of dischargesSnapshot.docs) {
          const discharge = dischargeDoc.data();
          if (String(discharge.hc) === String(hc)) {
            patientInfo = discharge;
            isDischarged = true;
            break;
          }
        }
      }
    } catch (e) {
      continue;
    }
    
    if (!patientInfo) continue;
    
    // Filtrar por paciente
    if (patientQuery) {
      const matchesName = patientInfo.paciente?.toLowerCase().includes(patientQuery.toLowerCase());
      const matchesHc = String(patientInfo.hc).includes(patientQuery);
      if (!matchesName && !matchesHc) continue;
    }
    
    // Filtrar por medicación
    if (drugQuery) {
      let drugMatch = false;
      for (const cat of CATS) {
        const cd = dayData[cat.id];
        if (!cd) continue;
        if ((cd.text || '').toLowerCase().includes(drugQuery.toLowerCase())) { drugMatch = true; break; }
        if ((cd.tags || []).some(t => t.toLowerCase().includes(drugQuery.toLowerCase()))) { drugMatch = true; break; }
      }
      if (!drugMatch) continue;
    }
    
    results.push({
      wid: weekId,
      day,
      patient: patientInfo,
      hc,
      dayData,
      isDischarged,
      cama: patientInfo.cama || patientInfo.camaAnterior || '—'
    });
  }
  
  return results;
}

// Cargar más resultados de Firestore (paginación)
async function loadMoreFirestoreResults() {
  const loading = document.getElementById('history-loading');
  const resultsDiv = document.getElementById('history-results');
  const paginationDiv = document.getElementById('history-pagination');
  
  loading.style.display = 'block';
  
  try {
    // Obtener lista de semanas disponibles
    let weeksQuery = collection(db, 'weeks');
    let weeksSnapshot;
    
    if (historyLastDoc) {
      weeksSnapshot = await getDocs(weeksQuery);
    } else {
      weeksSnapshot = await getDocs(weeksQuery);
    }
    
    const weeks = [];
    weeksSnapshot.forEach(doc => {
      weeks.push({ id: doc.id, data: doc.data() });
    });
    
    // Ordenar por ID descendente (más reciente primero)
    weeks.sort((a, b) => b.id.localeCompare(a.id));
    
    // Paginar semanas
    const startIdx = historyCurrentPage * HISTORY_PAGE_SIZE;
    const weeksToProcess = weeks.slice(startIdx, startIdx + HISTORY_PAGE_SIZE);
    
    if (weeksToProcess.length === 0 && historyCurrentPage === 0) {
      loading.style.display = 'none';
      resultsDiv.innerHTML = '<div class="no-data"><p>📭 No hay datos en Firestore.</p></div>';
      return;
    }
    
    let allResults = [];
    for (const week of weeksToProcess) {
      const filtered = await filterWeekData(
        week.id, 
        week.data, 
        historySearchParams?.patientQuery || '',
        historySearchParams?.drugQuery || ''
      );
      allResults.push(...filtered);
    }
    
    loading.style.display = 'none';
    
    if (allResults.length === 0 && historyCurrentPage === 0) {
      resultsDiv.innerHTML = '<div class="no-data"><p>🔍 No se encontraron resultados con esos filtros.</p></div>';
      paginationDiv.style.display = 'none';
      return;
    }
    
    // Si es primera página, reemplazar; si no, agregar
    if (historyCurrentPage === 0) {
      renderHistoryResults(allResults, `🔍 Resultados encontrados: ${allResults.length} registros`);
    } else {
      appendHistoryResults(allResults);
    }
    
    // Actualizar paginación
    const hasMore = weeks.length > (historyCurrentPage + 1) * HISTORY_PAGE_SIZE;
    updatePaginationControls(hasMore);
    
  } catch (error) {
    console.error('Pagination error:', error);
    loading.style.display = 'none';
    showToast('Error al cargar más resultados');
  }
}

function updatePaginationControls(hasMore) {
  const paginationDiv = document.getElementById('history-pagination');
  const prevBtn = document.getElementById('btn-prev-page');
  const nextBtn = document.getElementById('btn-next-page');
  const pageInfo = document.getElementById('page-info');
  
  paginationDiv.style.display = 'flex';
  prevBtn.style.display = historyCurrentPage > 0 ? 'inline-block' : 'none';
  nextBtn.style.display = hasMore ? 'inline-block' : 'none';
  pageInfo.textContent = `Página ${historyCurrentPage + 1}`;
}

function renderHistoryResults(results, title = null) {
  const el = document.getElementById('history-results');
  
  if (!results.length) {
    el.innerHTML = '<div class="no-data"><p>📭 No se encontraron resultados.</p></div>';
    document.getElementById('history-pagination').style.display = 'none';
    return;
  }
  
  // Agrupar por semana y paciente
  const grouped = {};
  for (const r of results) {
    const gkey = `${r.wid}_${r.hc}`;
    if (!grouped[gkey]) {
      grouped[gkey] = {
        wid: r.wid,
        patient: r.patient,
        hc: r.hc,
        days: {},
        isDischarged: r.isDischarged,
        cama: r.cama
      };
    }
    grouped[gkey].days[r.day] = r.dayData;
  }
  
  const titleHtml = title ? `<div style="margin-bottom:16px; font-size:13px; color:var(--text3); padding:8px 12px; background:var(--surface2); border-radius:8px;">${title}</div>` : '';
  
  el.innerHTML = titleHtml + Object.values(grouped).map(g => `
    <div class="hist-card" style="margin-bottom:12px; border:1px solid var(--border); border-radius:10px; overflow:hidden;">
      <div class="hist-card-header" style="display:flex; align-items:center; gap:8px; padding:12px; background:var(--surface2); cursor:pointer;">
        <span class="cell-room" style="background:var(--surface3); padding:2px 10px; border-radius:15px; font-family:var(--mono); font-size:12px; font-weight:600;">${g.cama}</span>
        <strong style="flex:1; font-size:14px;">${g.patient.paciente}</strong>
        <span style="font-family:var(--mono); font-size:11px; color:var(--text3); background:var(--surface); padding:2px 8px; border-radius:12px;">📅 ${g.wid}</span>
        ${g.isDischarged ? '<span style="background:#ef5e5e20; color:#ef5e5e; font-size:10px; padding:2px 8px; border-radius:12px;">🚪 ALTA</span>' : '<span style="background:#2da44e20; color:#2da44e; font-size:10px; padding:2px 8px; border-radius:12px;">🟢 ACTIVO</span>'}
        <span style="color:var(--text3); font-size:16px;">▾</span>
      </div>
      <div class="hist-card-body" style="display:none; padding:16px; background:var(--surface);">
        ${DAYS.filter(d => g.days[d]).map(d => {
          const dayData = g.days[d];
          const who = dayData._lastModifiedBy;
          const when = dayData._lastModifiedAt
            ? new Date(dayData._lastModifiedAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
            : null;
          
          const cats = CATS.filter(c => { 
            const e = dayData[c.id]; 
            return e && (e.tags?.length || e.text); 
          });
          
          return `
            <div style="border-left:3px solid var(--accent); padding-left:14px; margin-bottom:16px;">
              <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; flex-wrap:wrap;">
                <span style="font-weight:700; font-size:13px; background:var(--surface2); padding:2px 10px; border-radius:15px;">${DAY_LABELS[d]}</span>
                ${who ? `<span style="font-size:10px; color:var(--text3);">✎ ${who}${when ? ` · ${when}` : ''}</span>` : ''}
              </div>
              <div style="display:flex; flex-direction:column; gap:8px;">
                ${cats.map(c => {
                  const e = dayData[c.id];
                  const parts = [];
                  if (e.tags?.length) {
                    parts.push(`<div class="badge ${c.cls}" style="display:inline-block; margin-right:6px; margin-bottom:4px;">${e.tags.join('</div><div class="badge ' + c.cls + '" style="display:inline-block; margin-right:6px; margin-bottom:4px;">')}</div>`);
                  }
                  if (e.text) {
                    parts.push(`<div style="color:var(--text2); font-size:11px; margin-top:4px; padding:6px 8px; background:var(--surface2); border-radius:6px;">📝 ${e.text}</div>`);
                  }
                  return `<div><span style="color:${c.dot}; font-size:11px; font-weight:700; text-transform:uppercase;">${c.label}</span><br><div style="margin-top:4px;">${parts.join('')}</div></div>`;
                }).join('')}
              </div>
            </div>`;
        }).join('')}
        ${Object.keys(g.days).length === 0 ? '<div style="color:var(--text3); text-align:center; padding:20px;">Sin datos cargados esta semana</div>' : ''}
      </div>
    </div>
  `).join('');
  
  // Agregar event listeners para toggle
  document.querySelectorAll('.hist-card-header').forEach(header => {
    header.addEventListener('click', function(e) {
      e.stopPropagation();
      const body = this.nextElementSibling;
      const isOpen = body.style.display === 'block';
      body.style.display = isOpen ? 'none' : 'block';
      const arrow = this.querySelector('span:last-child');
      if (arrow) arrow.textContent = isOpen ? '▾' : '▴';
    });
  });
}

function appendHistoryResults(results) {
  const el = document.getElementById('history-results');
  // Remover el título si existe y agregar solo los nuevos resultados
  const existingCards = el.querySelectorAll('.hist-card');
  const newHtml = results.map(r => {
    // Reutilizar la misma lógica de renderizado para cada resultado
    return `<div class="hist-card" style="margin-bottom:12px; border:1px solid var(--border); border-radius:10px; overflow:hidden;">
      <div class="hist-card-header" style="display:flex; align-items:center; gap:8px; padding:12px; background:var(--surface2); cursor:pointer;">
        <span class="cell-room" style="background:var(--surface3); padding:2px 10px; border-radius:15px; font-family:var(--mono); font-size:12px; font-weight:600;">${r.cama}</span>
        <strong style="flex:1; font-size:14px;">${r.patient.paciente}</strong>
        <span style="font-family:var(--mono); font-size:11px; color:var(--text3); background:var(--surface); padding:2px 8px; border-radius:12px;">📅 ${r.wid}</span>
        <span style="color:var(--text3); font-size:16px;">▾</span>
      </div>
      <div class="hist-card-body" style="display:none; padding:16px; background:var(--surface);">
        <div style="color:var(--text3); text-align:center;">${Object.keys(r.days || {}).length} día(s) con datos</div>
      </div>
    </div>`;
  }).join('');
  
  el.insertAdjacentHTML('beforeend', newHtml);
  
  // Agregar event listeners a los nuevos elementos
  document.querySelectorAll('.hist-card-header').forEach(header => {
    header.removeEventListener('click', header._listener);
    const listener = function(e) {
      e.stopPropagation();
      const body = this.nextElementSibling;
      const isOpen = body.style.display === 'block';
      body.style.display = isOpen ? 'none' : 'block';
      const arrow = this.querySelector('span:last-child');
      if (arrow) arrow.textContent = isOpen ? '▾' : '▴';
    };
    header._listener = listener;
    header.addEventListener('click', listener);
  });
}

function nextHistoryPage() {
  historyCurrentPage++;
  loadMoreFirestoreResults();
}

function prevHistoryPage() {
  if (historyCurrentPage > 0) {
    historyCurrentPage--;
    loadMoreFirestoreResults();
  }
}
// ─── ADD PATIENT MODAL ────────────────────────────────────────────────────────
function openAddPatientModal() {
  if (!requireAuth()) return;
  document.getElementById('add-patient-form').reset();
  document.getElementById('new-cama').value = '';
  document.getElementById('new-floor-display').dataset.floor = '';

  // Render sector tabs
  const tabs = document.getElementById('new-sector-tabs');
  tabs.innerHTML = FLOORS.map(f => `
    <button type="button" class="move-floor-btn" data-floor="${f}"
            onclick="selectNewSector('${f}')">${FLOOR_LABELS[f]}</button>`
  ).join('');

  // Reset bed grid
  document.getElementById('new-bed-grid').innerHTML =
    '<span style="color:var(--text3);font-size:12px;">← Elegí un sector primero</span>';

  document.getElementById('add-patient-overlay').classList.add('open');
  setTimeout(() => document.getElementById('add-patient-modal').classList.add('open'), 10);
}

window.selectNewSector = function(floorId) {
  document.querySelectorAll('#new-sector-tabs .move-floor-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.floor === floorId));
  renderNewBedGrid(floorId);
};

function renderNewBedGrid(floorId) {
  const beds = BED_STRUCTURE[floorId] || [];
  const occupied = new Set(Object.values(allPatients).filter(isPatientActive).map(p => p.cama));
  const selected = document.getElementById('new-cama').value;
  document.getElementById('new-bed-grid').innerHTML = beds.map(cama => {
    const isBusy = occupied.has(cama);
    const isSel  = cama === selected;
    return `
      <button type="button"
              class="bed-card ${isBusy ? 'occupied' : ''} ${isSel ? 'selected' : ''}"
              onclick="selectNewBed('${cama}','${floorId}',this)"
              ${isBusy ? `title="Ocupada por ${Object.values(allPatients).find(p => isPatientActive(p) && p.cama === cama)?.paciente || ''}"` : ''}>
        <div class="bed-card-room">${cama}</div>
        <div class="bed-card-status ${isBusy ? 'busy' : 'free'}">${isBusy ? '● Ocupada' : '○ Libre'}</div>
      </button>`;
  }).join('');
}

window.selectNewBed = function(cama, floorId, el) {
  document.querySelectorAll('#new-bed-grid .bed-card').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('new-cama').value = cama;
  document.getElementById('new-floor-display').dataset.floor = floorId;
};

function closeAddPatientModal() {
  document.getElementById('add-patient-overlay').classList.remove('open');
  document.getElementById('add-patient-form').reset();
}

// ─── LÓGICA DE DETECCIÓN DE PISOS ──────────────────────────────────────────────
// ─── BED STRUCTURE (fuente de verdad para camas y pisos) ──────────────────────
const BED_STRUCTURE = {
  '3': [
    '301','302','303','304','305','306','307','308','309','310',
    '311','312','314','315','316','317','318','319','321','322',
    '323','324','325','326','327','328','329','330','331','332',
    '333','334','335','336','337','338','339','340',
  ],
  '4': [
    '414','415','416','417','418','419','420','421','422','423',
    '424','425','426','427','428',
  ],
  '5': [
    '501','502','503','504','505','506','507','508','509',
    '514','515','516','517','518','519','520','521','522','523',
    '524','525','526','527','528',
  ],
  'tamo': [
    'TAMO 01','TAMO 02','TAMO 03','TAMO 04','TAMO 05','TAMO 06',
  ],
  'uti': [
    'UTI 01','UTI 02','UTI 03','UTI 04','UTI 05','UTI 07',
  ],
  'utiq': [
    'U.T.Q 01','U.T.Q 02','U.T.Q 03','U.T.Q 04','U.T.Q 05','U.T.Q 06',
  ],
};

// Reverse lookup: cama → floorId  (built once at startup)
const CAMA_TO_FLOOR = {};
for (const [floorId, camas] of Object.entries(BED_STRUCTURE)) {
  for (const cama of camas) {
    CAMA_TO_FLOOR[cama.toUpperCase()] = floorId;
  }
}

// detectFloor: primero busca en la estructura fija, luego heurística para CSV imports
function detectFloor(cama, agrupacionHint = '') {
  if (!cama) return null;

  // 1. Lookup exacto en la estructura de camas conocidas
  const key = String(cama).trim().toUpperCase();
  if (CAMA_TO_FLOOR[key]) return CAMA_TO_FLOOR[key];

  // 2. Heurística para CSV basada en la agrupación (columna 9 del CSV)
  const agrp = (agrupacionHint || '').toUpperCase();
  
  // Detectar UTIQ (U.T.I.Q  PISO2, U.T.I.Q, UTIQ, U.T.Q)
  if (agrp.includes('U.T.I.Q') || agrp.includes('UTIQ') || agrp.includes('U.T.Q')) return 'utiq';
  
  // Detectar UTI
  if (agrp.includes('U.T.I') || agrp.includes('UTI')) return 'uti';
  
  // Detectar TAMO
  if (agrp.includes('TAMO')) return 'tamo';
  
  // Detectar Pisos (con o sin espacio)
  if (agrp.includes('PISO 3') || agrp.includes('PISO3')) return '3';
  if (agrp.includes('PISO 4') || agrp.includes('PISO4')) return '4';
  if (agrp.includes('PISO 5') || agrp.includes('PISO5')) return '5';
  
  // 3. Fallback: detectar por el número de cama
  const numMatch = key.match(/^(\d)/);
  if (numMatch) {
    const firstDigit = numMatch[1];
    if (firstDigit === '3') return '3';
    if (firstDigit === '4') return '4';
    if (firstDigit === '5') return '5';
  }
  
  // 4. Detectar por texto de cama
  if (key.includes('UTIQ') || key.includes('U.T.Q')) return 'utiq';
  if (key.includes('UTI')) return 'uti';
  if (key.includes('TAMO')) return 'tamo';

  return null;
}

function saveNewPatient() {
  if (!requireAuth()) return;
  const cama = document.getElementById('new-cama').value.trim();
  const paciente = document.getElementById('new-paciente').value.trim();
  const hc = document.getElementById('new-hc').value.trim();
  const medico = document.getElementById('new-medico').value.trim();
  const cobertura = document.getElementById('new-cobertura').value.trim();
  const ingreso = document.getElementById('new-ingreso').value;
  const dias = document.getElementById('new-dias').value;
  const servicio = document.getElementById('new-servicio').value.trim();
  const diagnostico = document.getElementById('new-diagnostico').value.trim();

  if (!cama || !paciente || !hc) {
    showToast('Complete los campos obligatorios');
    return;
  }

  const camaOcupada = Object.values(allPatients).find(p => p.cama === cama && isPatientActive(p));
  if (camaOcupada) {
    showToast(`La cama ${cama} ya está ocupada por ${camaOcupada.paciente}`);
    return;
  }

  // Floor viene directo del selector — no hace falta detectar
  const floor = document.getElementById('new-floor-display').dataset.floor || detectFloor(cama, servicio);
  if (!floor) {
    showToast('Seleccioná un sector y una cama');
    return;
  }
  const newPatient = {
  cama, hc, paciente, medico: medico || '—', cobertura: cobertura || '—',
  ingreso: ingreso || '—', dias: dias || '0', servicio: servicio || '—',
  diagnostico: diagnostico || 'SIN DIAGNÓSTICO', floor,
  status: PATIENT_STATUS.ACTIVE
};

  allPatients[hc] = newPatient;
  localStorage.setItem('sc_patients', JSON.stringify(allPatients));

  if (db) {
    setDoc(doc(db, 'patients', hc), newPatient).catch(() => { });
  }

  saveAudit('create', hc, null, { paciente, cama, medico });
  closeAddPatientModal();
  renderTable();
  renderFloorTabs();
  showToast('Paciente agregado ✓');
}

// ─── PATIENT DAYS VIEW ────────────────────────────────────────────────────────
function openPatientDays(hc) {
  const p = allPatients[hc];
  if (!p) return;
  currentDaysHc = hc;
  document.getElementById('days-patient-name').textContent = p.paciente;
  document.getElementById('days-patient-meta').textContent = `Cama ${p.cama} · HC ${p.hc} · ${p.medico || ''}`;
  const copyBtn = document.getElementById('days-panel-copy-prev');
  if (copyBtn) copyBtn.style.display = hasPrevWeekData(hc) ? 'flex' : 'none';
  renderPatientDaysList();
  document.getElementById('patient-days-overlay').classList.add('open');
  setTimeout(() => document.getElementById('patient-days-panel').classList.add('open'), 10);
}

function closePatientDays() {
  document.getElementById('patient-days-panel').classList.remove('open');
  setTimeout(() => {
    document.getElementById('patient-days-overlay').classList.remove('open');
  }, 250);
}

function renderPatientDaysList() {
  const el = document.getElementById('patient-days-list');
  const daysHtml = DAYS.map(day => {
    const entry = weekData[`${currentDaysHc}_${day}`];
    const hasEntry = entry && CATS.some(c => entry[c.id] && (entry[c.id].text || entry[c.id].tags?.length));
    if (!hasEntry) {
      return `
        <div class="day-list-item" data-day="${day}">
          <div class="day-list-header">
            <span class="day-list-day">${DAY_LABELS[day]}</span>
            <span class="day-list-empty">Sin datos cargados</span>
          </div>
        </div>`;
    }
    const badges = CATS.filter(c => {
      const d = entry[c.id];
      return d && (d.text || d.tags?.length);
    }).map(c => `<span class="badge ${c.cls}">${c.label.substring(0, 3).toUpperCase()}</span>`).join('');
    const summaries = [];
    CATS.forEach(c => {
      const d = entry[c.id];
      if (d) {
        if (d.tags?.length) summaries.push(`${c.label}: ${d.tags.join(', ')}`);
        else if (d.text) summaries.push(`${c.label}: ${d.text.substring(0, 30)}...`);
      }
    });
    if (entry._lastModifiedBy) {
      summaries.push(`<span style="font-size:9px;color:var(--text3)">👤 ${entry._lastModifiedBy}</span>`);
    }
    return `
      <div class="day-list-item" data-day="${day}">
        <div class="day-list-header">
          <span class="day-list-day">${DAY_LABELS[day]}</span>
          <div class="day-list-badges">${badges}</div>
        </div>
        <div class="day-list-summary">${summaries.join('<br>')}</div>
      </div>`;
  }).join('');
  el.innerHTML = daysHtml;

  document.querySelectorAll('#patient-days-list .day-list-item').forEach(item => {
    const day = item.dataset.day;
    item.addEventListener('click', () => openPanel(currentDaysHc, day));
  });
}

function addDayEntry() {
  if (!currentDaysHc) return;
  const dayMap = { 1: 'lunes', 2: 'martes', 3: 'miercoles', 4: 'jueves', 5: 'viernes' };
  const todayDay = new Date().getDay();
  const targetDay = dayMap[todayDay] || 'lunes';
  openPanel(currentDaysHc, targetDay);
}

// ─── DISCHARGE PATIENT ────────────────────────────────────────────────────────
function dischargePatient(hc) {
  const p = allPatients[hc];
  if (!p) return;
  showDischargeConfirm(hc, p);
}

function showDischargeConfirm(hc, p) {
  document.getElementById('discharge-confirm')?.remove();
  const div = document.createElement('div');
  div.id = 'discharge-confirm';
  div.style.cssText = `
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
    background:var(--surface3); border:1px solid var(--cat-qmt);
    border-radius:8px; padding:14px 18px; z-index:500;
    display:flex; align-items:center; gap:12px; max-width:90vw;
    box-shadow:0 8px 32px rgba(0,0,0,0.4); animation: slideUp .2s ease;
  `;
  div.innerHTML = `
    <span style="font-size:12px;color:var(--text2);">
      ¿Dar de alta a <strong style="color:var(--text)">${p.paciente.split(',')[0]}</strong> (cama ${p.cama})?
    </span>
    <div style="display:flex;gap:6px;flex-shrink:0;">
      <button class="btn" id="cancel-discharge" style="padding:4px 10px;font-size:11px;">Cancelar</button>
      <button class="btn" id="confirm-discharge" style="padding:4px 10px;font-size:11px;background:var(--cat-qmt);border-color:var(--cat-qmt);color:#fff;">Confirmar alta</button>
    </div>`;
  document.body.appendChild(div);
  document.getElementById('cancel-discharge').onclick = () => div.remove();
  document.getElementById('confirm-discharge').onclick = async () => {
    div.remove();
    await executeDischarge(hc, p);
  };
  setTimeout(() => div?.remove(), 8000);
}

async function executeDischarge(hc, p) {
  // Guardar entradas de la semana actual para historial
  const currentWeekEntries = {};
  for (const day of DAYS) {
    const key = `${hc}_${day}`;
    if (weekData[key]) currentWeekEntries[key] = weekData[key];
  }

  // Registrar el alta en el objeto del paciente
  const camaLiberada = p.cama;
  p.status = PATIENT_STATUS.ARCHIVED;
  p.dischargeAt = new Date().toISOString();
  p.dischargeWeek = currentWeek;
  p.dischargedBy = getDisplayName(currentUser);
  p.archivedAt = p.dischargeAt;
  p.archivedReason = 'discharge';
  p.archivedBy = p.dischargedBy;
  p.camaAnterior = camaLiberada;
  p.cama = '';          // liberar la cama — ya no figura como ocupada

  // Guardar el registro completo de alta
  const dischargeRecord = {
    ...p,
    weekEntries: currentWeekEntries,
  };
  const discharges = JSON.parse(localStorage.getItem('sc_discharges') || '[]');
  discharges.unshift(dischargeRecord);
  localStorage.setItem('sc_discharges', JSON.stringify(discharges));

  // Actualizar allPatients (el paciente permanece archivado para historial)
  allPatients[hc] = p;
  localStorage.setItem('sc_patients', JSON.stringify(allPatients));

  // ❌ ELIMINAR ESTE BLOQUE - NO borrar los datos de la semana
  // for (const day of DAYS) {
  //   delete weekData[`${hc}_${day}`];
  // }
  
  // ✅ En su lugar, guardar weekData sin cambios
  localStorage.setItem(`sc_week_${currentWeek}`, JSON.stringify(weekData));

  saveAudit('delete', hc, null, { action: 'discharge', patientName: p.paciente, cama: camaLiberada });

  // Sync con Firestore si está activo
  if (db) {
    try {
      await setDoc(doc(db, 'discharges', `${hc}_${Date.now()}`), dischargeRecord);
      await setDoc(doc(db, 'patients', String(hc)), p);
    } catch (e) {
      showToast('Alta guardada localmente, pero falló sync en Firestore');
    }
  }

  renderTable(document.getElementById('search-input').value);
  renderFloorTabs();
  showToast(`${p.paciente.split(',')[0]} dado/a de alta ✓`);
}

// ─── MOVE PATIENT ─────────────────────────────────────────────────────────────
function openMovePatient(hc) {
  if (!requireAuth()) return;
  const p = allPatients[hc];
  if (!p) return;
  movePatientHc = hc;
  moveFilterFloor = 'all';
  moveSelectedRoom = null;
  document.getElementById('move-patient-name-label').textContent = p.paciente;
  document.getElementById('move-current-room').textContent = p.cama;
  document.getElementById('new-move-room').value = '';
  document.getElementById('move-search').value = '';
  document.getElementById('move-room-warning').style.display = 'none';
  const filterEl = document.getElementById('move-floor-filter');
  filterEl.innerHTML = [
    `<button class="move-floor-btn active" data-floor="all">Todos</button>`,
    ...FLOORS.map(f => `<button class="move-floor-btn" data-floor="${f}">${FLOOR_LABELS[f] || f}</button>`)
  ].join('');
  document.querySelectorAll('.move-floor-btn').forEach(btn => {
    btn.addEventListener('click', () => setMoveFloor(btn.dataset.floor, btn));
  });
  renderMoveGrid();
  document.getElementById('move-patient-overlay').classList.add('open');
}

function setMoveFloor(floor, btn) {
  moveFilterFloor = floor;
  document.querySelectorAll('.move-floor-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderMoveGrid();
}

function renderMoveGrid() {
  const search = (document.getElementById('move-search')?.value || '').toLowerCase();
  const grid = document.getElementById('move-bed-grid');

  // Build occupied map
  const occupiedBy = {};
  Object.values(allPatients).forEach(p => {
    if (isPatientActive(p) && String(p.hc) !== String(movePatientHc)) {
      occupiedBy[p.cama] = p;
    }
  });

  // Determine which floors to show
  const floorsToShow = moveFilterFloor === 'all' ? FLOORS : [moveFilterFloor];

  // Collect all beds in canonical order
  const allBeds = [];
  for (const f of floorsToShow) {
    for (const cama of (BED_STRUCTURE[f] || [])) {
      if (search && !cama.toLowerCase().includes(search) &&
          !(occupiedBy[cama]?.paciente || '').toLowerCase().includes(search)) continue;
      allBeds.push({ cama, floor: f, patient: occupiedBy[cama] || null });
    }
  }

  if (!allBeds.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text3);font-size:12px;">Sin camas para los filtros actuales</div>`;
    return;
  }

  grid.innerHTML = allBeds.map(({ cama, patient }) => {
    const isBusy     = !!patient;
    const isSelected = moveSelectedRoom === cama;
    const nameLine   = isBusy
      ? `<div class="bed-card-name">${patient.paciente.split(',')[0]}</div>`
      : '';
    return `
      <div class="bed-card ${isBusy ? 'occupied' : ''} ${isSelected ? 'selected' : ''}"
           data-room="${cama}" title="${isBusy ? 'Ocupada — clic para intercambiar' : 'Libre'}">
        <div class="bed-card-room">${cama}</div>
        ${nameLine}
        <div class="bed-card-status ${isBusy ? 'busy' : 'free'}">${isBusy ? '● Ocupada' : '○ Libre'}</div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.bed-card').forEach(card => {
    card.addEventListener('click', () => selectMoveRoom(card.dataset.room, card));
  });
}

function selectMoveRoom(room, el) {
  if (moveSelectedRoom === room) {
    moveSelectedRoom = null;
    el.classList.remove('selected');
  } else {
    moveSelectedRoom = room;
    document.querySelectorAll('.bed-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    document.getElementById('new-move-room').value = '';
  }
  document.getElementById('move-room-warning').style.display = 'none';
}

function clearMoveGridSelection() {
  moveSelectedRoom = null;
  document.querySelectorAll('.bed-card').forEach(c => c.classList.remove('selected'));
}

function closeMovePatientModal() {
  document.getElementById('move-patient-overlay').classList.remove('open');
  movePatientHc = null;
  moveSelectedRoom = null;
}

function confirmMovePatient() {
  if (!movePatientHc) return;
  const newRoom = moveSelectedRoom || document.getElementById('new-move-room').value.trim();
  if (!newRoom) {
    showToast('Seleccioná una cama o ingresá una manualmente');
    return;
  }
  const p = allPatients[movePatientHc];
  if (!p) return;
  const oldRoom = p.cama;
  const existingPatient = Object.values(allPatients).find(pat =>
    isPatientActive(pat) && pat.cama === newRoom && String(pat.hc) !== String(movePatientHc)
  );
  if (existingPatient) {
    const warn = document.getElementById('move-room-warning');
    warn.textContent = `⚠ La cama ${newRoom} está ocupada por ${existingPatient.paciente}. ¿Querés intercambiar posiciones? (clic para intercambiar)`;
    warn.style.display = 'block';
    warn.onclick = () => { doSwapRooms(movePatientHc, String(existingPatient.hc)); };
    warn.style.cursor = 'pointer';
    return;
  }
  p.cama = newRoom;
  p.floor = detectFloor(newRoom, p.servicio || '');
  localStorage.setItem('sc_patients', JSON.stringify(allPatients));
  if (db) setDoc(doc(db, 'patients', movePatientHc), p).catch(() => { });
  saveAudit('modify', movePatientHc, null, { action: 'move', from: oldRoom, to: newRoom });
  closeMovePatientModal();
  renderTable();
  showToast(`${p.paciente.split(',')[0]} movido/a de ${oldRoom} → ${newRoom} ✓`);
}

function doSwapRooms(hc1, hc2) {
  const p1 = allPatients[hc1];
  const p2 = allPatients[hc2];
  if (!p1 || !p2) return;
  const tmp = p1.cama;
  p1.cama = p2.cama;
  p2.cama = tmp;
  p1.floor = detectFloor(p1.cama, p1.servicio || '');
  p2.floor = detectFloor(p2.cama, p2.servicio || '');
  localStorage.setItem('sc_patients', JSON.stringify(allPatients));
  if (db) {
    setDoc(doc(db, 'patients', hc1), p1).catch(() => { });
    setDoc(doc(db, 'patients', hc2), p2).catch(() => { });
  }
  saveAudit('modify', hc1, null, { action: 'swap', with: hc2 });
  saveAudit('modify', hc2, null, { action: 'swap', with: hc1 });
  closeMovePatientModal();
  renderTable();
  showToast(`Camas intercambiadas ✓`);
}

// ─── WEEK COPY ────────────────────────────────────────────────────────────────
function getPrevWeekId(weekId) {
  const [y, wn] = weekId.replace('W', '').split('-').map(Number);
  const jan4 = new Date(y, 0, 4);
  const startOfWeek = new Date(jan4);
  startOfWeek.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7 + (wn - 1) * 7 - 7);
  return getWeekId(startOfWeek);
}

function hasPrevWeekData(hc) {
  const prevWeek = getPrevWeekId(currentWeek);
  const prevData = JSON.parse(localStorage.getItem(`sc_week_${prevWeek}`) || '{}');
  return DAYS.some(d => {
    const e = prevData[`${hc}_${d}`];
    return e && CATS.some(c => e[c.id] && (e[c.id].text || e[c.id].tags?.length));
  });
}

function copiarSemanaAnterior(hc) {
  const prevWeek = getPrevWeekId(currentWeek);
  const prevData = JSON.parse(localStorage.getItem(`sc_week_${prevWeek}`) || '{}');
  let copied = 0;
  DAYS.forEach(d => {
    const key = `${hc}_${d}`;
    const prev = prevData[key];
    if (prev && CATS.some(c => prev[c.id] && (prev[c.id].text || prev[c.id].tags?.length))) {
      if (!weekData[key]) {
        weekData[key] = JSON.parse(JSON.stringify(prev));
        copied++;
      }
    }
  });
  if (copied === 0) {
    showToast('Los días de esta semana ya tienen datos cargados');
    return;
  }
  localStorage.setItem(`sc_week_${currentWeek}`, JSON.stringify(weekData));
  queueWeekAutosave();
  if (window.innerWidth <= 640 && document.getElementById('patient-days-overlay').classList.contains('open')) {
    renderPatientDaysList();
  } else {
    renderDaysRowContent(hc);
  }
  showToast(`${copied} día${copied !== 1 ? 's' : ''} copiados de la semana anterior ✓`);
}

// ─── SAVE WEEK ────────────────────────────────────────────────────────────────
async function saveWeek() {
  if (weekAutosaveTimer) {
    clearTimeout(weekAutosaveTimer);
    weekAutosaveTimer = null;
  }
  localStorage.setItem(`sc_week_${currentWeek}`, JSON.stringify(weekData));
  if (db) {
    const btn = document.getElementById('btn-save-week');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Guardando...';
    try {
      await saveToFirestore();
      showToast('Semana guardada en Firestore ✓');
    } catch (e) { }
    btn.innerHTML = originalHtml;
  } else {
    showToast('Semana guardada localmente ✓');
  }
}

// ─── HANDLE PATIENT ROW CLICK ─────────────────────────────────────────────────
function handlePatientRowClick(hc) {
  if (window.innerWidth <= 640) {
    openPatientDays(hc);
  } else {
    toggleDaysRow(hc);
  }
}

// ─── FILTER PATIENTS ──────────────────────────────────────────────────────────
function filterPatients(q) {
  renderTable(q);
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 2800);
}

// ─── RENDER ALL ───────────────────────────────────────────────────────────────
function renderAll() {
  updateWeekLabel();
  renderFloorTabs();
  renderTable();
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  updateWeekLabel();
  renderFloorTabs();
  updateUserUI(null);

  // Show login screen immediately — onAuthStateChanged will hide it if session is valid
  showLoginScreen();

  // 1. Priority: build-time env vars → always use Firebase Auth
  if (HAS_ENV_CONFIG) {
    await initFirebase(ENV_CONFIG);
    return;
  }

  // 2. Fallback: manually saved config in localStorage
  const saved = localStorage.getItem('sc_fb_config');
  if (saved) {
    try {
      const cfg = JSON.parse(saved);
      await initFirebase(cfg);
      return;
    } catch (e) { /* invalid config, fall through */ }
  }

  // 3. No Firebase config → local mode (no login required)
  localMode = true;
  hideLoginScreen();
  document.getElementById('config-banner').classList.remove('hidden');
  renderAll();
}

// ─── PRINT ────────────────────────────────────────────────────────────────────
let printDay   = null;
let printFloor = null;

function openPrintModal() {
  if (!requireAuth()) return;

  // Default: today's weekday, current floor
  const todayMap = { 1:'lunes',2:'martes',3:'miercoles',4:'jueves',5:'viernes' };
  printDay   = todayMap[new Date().getDay()] || 'lunes';
  printFloor = currentFloor;

  // Day picker
  document.getElementById('print-day-picker').innerHTML = DAYS.map(d => `
    <button type="button" class="move-floor-btn ${d === printDay ? 'active' : ''}"
            data-day="${d}" id="pday-${d}">${DAY_LABELS[d]}</button>`).join('');

  // Floor picker
  document.getElementById('print-floor-picker').innerHTML = FLOORS.map(f => `
    <button type="button" class="move-floor-btn ${f === printFloor ? 'active' : ''}"
            data-floor="${f}" id="pfloor-${f}">${FLOOR_LABELS[f]}</button>`).join('');

  document.querySelectorAll('#print-day-picker .move-floor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      printDay = btn.dataset.day;
      document.querySelectorAll('#print-day-picker .move-floor-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updatePrintCount();
    });
  });

  document.querySelectorAll('#print-floor-picker .move-floor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      printFloor = btn.dataset.floor;
      document.querySelectorAll('#print-floor-picker .move-floor-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updatePrintCount();
    });
  });

  updatePrintCount();
  document.getElementById('print-overlay').style.display = 'flex';
}

function updatePrintCount() {
  const patients = getPrintPatients();
  const withMeds = patients.filter(p => hasMedsForDay(p.hc, printDay));
  document.getElementById('print-preview-count').textContent =
    `${patients.length} paciente${patients.length !== 1 ? 's' : ''} en ${FLOOR_LABELS[printFloor]} · ${withMeds.length} con medicación cargada`;
}

function getPrintPatients() {
  const knownBeds = BED_STRUCTURE[printFloor] || [];
  const byBed = {};
  Object.values(allPatients).forEach(p => {
    if (isPatientActive(p) && (p.floor || '').toLowerCase() === printFloor.toLowerCase()) {
      byBed[p.cama] = p;
    }
  });
  const ordered = knownBeds.filter(c => byBed[c]).map(c => byBed[c]);
  const extra   = Object.values(byBed).filter(p => !knownBeds.includes(p.cama))
                        .sort((a, b) => String(a.cama).localeCompare(String(b.cama)));
  return [...ordered, ...extra];
}

function hasMedsForDay(hc, day) {
  const entry = weekData[`${hc}_${day}`];
  return entry && CATS.some(c => entry[c.id] && (entry[c.id].tags?.length || entry[c.id].text));
}

function buildMedLine(entry) {
  // Returns a flat array of medication strings for a day entry
  const lines = [];
  CATS.forEach(cat => {
    const d = entry?.[cat.id];
    if (!d) return;
    const parts = [];
    if (d.tags?.length) parts.push(d.tags.join(', '));
    if (d.text?.trim()) parts.push(d.text.trim());
    if (parts.length) lines.push(`[${cat.label}] ${parts.join(' — ')}`);
  });
  return lines;
}

function doPrint() {
  const patients = getPrintPatients();
  const dayDates = getWeekDayDates(currentWeek);
  const reportDay = dayDates[printDay] || new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  const reportDate = new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit' });

 const rows = [];
  for (const p of patients) {
    const entry   = weekData[`${p.hc}_${printDay}`];
    const medLines = buildMedLine(entry);
    const medsHtml = medLines.length
      ? `<div class="print-meds-line">• ${medLines.join(' · ')}</div>`
      : '<div class="print-no-meds">Sin medicación cargada</div>';

    // ✅ CORRECCIÓN: Usamos rows.push() y quitamos el ")" sobrante al final.
    // También inyectamos medsHtml en lugar de medsText.
    rows.push(`
      <div class="print-patient">
        <div class="print-patient-line">${p.cama} ${p.paciente}:</div>
        ${medsHtml}
      </div>
      <hr class="print-separator">`);
  }

  // ✅ CORRECCIÓN: Usamos rows.join('') para convertir el array en texto HTML válido
  document.getElementById('print-content').innerHTML = `
    <div class="print-header">Pase de Guardia - ${FLOOR_LABELS[printFloor]} - Dia ${reportDay} (${reportDate})</div>
    ${rows.length > 0 ? rows.join('') : '<p style="font-size: 9px;color:#888;font-style:italic">Sin pacientes en este sector.</p>'}`;

  document.getElementById('print-overlay').style.display = 'none';
  requestAnimationFrame(() => window.print());
}

function closePrintModal() {
  document.getElementById('print-overlay').style.display = 'none';
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────────────────
document.getElementById('prev-week').addEventListener('click', () => changeWeek(-1));
document.getElementById('next-week').addEventListener('click', () => changeWeek(1));
document.getElementById('btn-csv').addEventListener('click', () => openCSV());
document.getElementById('btn-history').addEventListener('click', () => toggleView('history'));
document.getElementById('btn-back-main').addEventListener('click', () => toggleView('main'));
document.getElementById('btn-save-week').addEventListener('click', () => saveWeek());
document.getElementById('btn-add-patient').addEventListener('click', () => openAddPatientModal());

// Config banner (shown when no env vars are set)
document.getElementById('btn-save-config').addEventListener('click', () => saveConfig());
document.getElementById('btn-local-mode').addEventListener('click', () => useLocalMode());
document.getElementById('btn-login').addEventListener('click', () => doLogin());
document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('login-email').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('login-pass').focus(); });
document.getElementById('btn-forgot').addEventListener('click', () => doForgotPassword());
document.getElementById('btn-logout').addEventListener('click', () => doLogout());
document.getElementById('btn-print').addEventListener('click', () => openPrintModal());
document.getElementById('confirm-print').addEventListener('click', () => doPrint());
document.getElementById('cancel-print').addEventListener('click', () => closePrintModal());
document.getElementById('close-print').addEventListener('click', () => closePrintModal());
document.getElementById('print-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('print-overlay')) closePrintModal();
});
document.getElementById('close-profile').addEventListener('click', () => closeProfileModal());
document.getElementById('cancel-profile').addEventListener('click', () => closeProfileModal());
document.getElementById('save-profile').addEventListener('click', () => saveUserProfile());
document.getElementById('profile-name').addEventListener('keydown', e => { if (e.key === 'Enter') saveUserProfile(); });
document.getElementById('profile-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('profile-overlay')) closeProfileModal();
});

// Password visibility toggle
document.getElementById('btn-toggle-pass').addEventListener('click', () => {
  const input = document.getElementById('login-pass');
  const isText = input.type === 'text';
  input.type = isText ? 'password' : 'text';
  document.getElementById('eye-icon').innerHTML = isText
    ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
});

document.getElementById('search-input').addEventListener('input', (e) => filterPatients(e.target.value));

// Panel event listeners
document.getElementById('entry-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('entry-overlay')) closePanel();
});
document.getElementById('panel-close').addEventListener('click', () => closePanel());
document.getElementById('panel-cancel').addEventListener('click', () => closePanel());
document.getElementById('btn-copy-prev').addEventListener('click', () => copyToPrevDay());
document.getElementById('panel-save').addEventListener('click', () => saveEntry());

// Add patient modal
document.getElementById('close-add-patient').addEventListener('click', () => closeAddPatientModal());
document.getElementById('cancel-add-patient').addEventListener('click', () => closeAddPatientModal());
document.getElementById('confirm-add-patient').addEventListener('click', () => saveNewPatient());
document.getElementById('add-patient-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('add-patient-overlay')) closeAddPatientModal();
});

// Move patient modal
document.getElementById('close-move-patient').addEventListener('click', () => closeMovePatientModal());
document.getElementById('cancel-move-patient').addEventListener('click', () => closeMovePatientModal());
document.getElementById('confirm-move-patient').addEventListener('click', () => confirmMovePatient());
document.getElementById('move-patient-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('move-patient-overlay')) closeMovePatientModal();
});
document.getElementById('move-search').addEventListener('input', () => renderMoveGrid());
document.getElementById('new-move-room').addEventListener('input', () => clearMoveGridSelection());
document.getElementById('new-move-room').addEventListener('focus', () => clearMoveGridSelection());

// Patient days panel
document.getElementById('close-patient-days').addEventListener('click', () => closePatientDays());
document.getElementById('close-days-panel').addEventListener('click', () => closePatientDays());
document.getElementById('days-panel-copy-prev').addEventListener('click', () => {
  if (currentDaysHc) copiarSemanaAnterior(currentDaysHc);
});
document.getElementById('days-panel-move').addEventListener('click', () => {
  if (currentDaysHc) openMovePatient(currentDaysHc);
});
document.getElementById('days-panel-discharge').addEventListener('click', () => {
  if (currentDaysHc) dischargePatient(currentDaysHc);
});
document.getElementById('btn-add-day-entry').addEventListener('click', () => addDayEntry());
document.getElementById('patient-days-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('patient-days-overlay')) closePatientDays();
});

// CSV modal
document.getElementById('close-csv').addEventListener('click', () => closeCSV());
document.getElementById('cancel-csv').addEventListener('click', () => closeCSV());
document.getElementById('btn-import').addEventListener('click', () => importPatients());
document.getElementById('csv-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('csv-overlay')) closeCSV();
});

// Drop zone
const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('click', () => document.getElementById('file-input').click());
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', handleDrop);
document.getElementById('file-input').addEventListener('change', (e) => handleFileInput(e.target));

// History view mode toggles
document.getElementById('hist-view-lastweek').addEventListener('click', () => {
  historyMode = 'lastweek';
  document.getElementById('hist-view-lastweek').classList.add('active');
  document.getElementById('hist-view-search').classList.remove('active');
  document.getElementById('hist-search-panel').style.display = 'none';
  document.getElementById('history-pagination').style.display = 'none';
  loadLastWeekFromFirestore();
});

document.getElementById('hist-view-search').addEventListener('click', () => {
  historyMode = 'search';
  document.getElementById('hist-view-search').classList.add('active');
  document.getElementById('hist-view-lastweek').classList.remove('active');
  document.getElementById('hist-search-panel').style.display = 'block';
  document.getElementById('history-pagination').style.display = 'none';
  document.getElementById('history-results').innerHTML = '<div class="no-data" style="text-align:center; padding:40px;"><p>🔍 Completá los filtros y presioná "Buscar" para consultar Firestore.</p></div>';
});

// Botón de búsqueda explícito
document.getElementById('btn-search-history').addEventListener('click', () => {
  executeFirestoreSearch();
});

// Permitir búsqueda con Enter
document.getElementById('hist-search-patient').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') executeFirestoreSearch();
});
document.getElementById('hist-search-drug').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') executeFirestoreSearch();
});
document.getElementById('hist-search-week').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') executeFirestoreSearch();
});

// Paginación
document.getElementById('btn-prev-page').addEventListener('click', () => prevHistoryPage());
document.getElementById('btn-next-page').addEventListener('click', () => nextHistoryPage());

// Escape key
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('entry-panel').classList.contains('open')) { closePanel(); return; }
  if (document.getElementById('move-patient-overlay').classList.contains('open')) { closeMovePatientModal(); return; }
  if (document.getElementById('add-patient-overlay').classList.contains('open')) { closeAddPatientModal(); return; }
  if (document.getElementById('csv-overlay').classList.contains('open')) { closeCSV(); return; }
  if (document.getElementById('patient-days-overlay').classList.contains('open')) { closePatientDays(); return; }
  if (currentDaysHc) {
    const row = document.getElementById(`days-row-${currentDaysHc}`);
    if (row) row.style.display = 'none';
    currentDaysHc = null;
  }
});

// Start the app
init();
