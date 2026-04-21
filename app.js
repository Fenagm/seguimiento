// ─── IMPORTS ──────────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, deleteDoc, collection, getDocs, query, where, orderBy, writeBatch } from 'firebase/firestore';

// ─── CATEGORIES & TAGS ───────────────────────────────────────────────────────
const CATS = [
  { id: 'nutricion', label: 'Nutrición', cls: 'nut', dot: '#2da44e' },
  { id: 'sedacion', label: 'Sedación', cls: 'sed', dot: '#c87af0' },
  { id: 'antibioticos', label: 'Antibióticos', cls: 'atb', dot: '#f5a623' },
  { id: 'qmt', label: 'QMT', cls: 'qmt', dot: '#ef5e5e' },
  { id: 'otros', label: 'Otros', cls: 'oth', dot: '#4ab3c7' },
];

const TAGS = {
  nutricion: ['NPT Magistral 63 ml/h', 'Fresubin Original 63 ml/h', 'Fresubin Energy 42 ml/h', 'Protison 42 ml/h', 'NE por SNG', 'Ayuno', 'Dieta blanda'],
  sedacion: ['Midazolam', 'Metadona 5mg c/8h', 'Morfina', 'Oxicodona', 'Fentanilo', 'Propofol', 'Dexmedetomidina', 'Ketamina'],
  antibioticos: ['Vancomicina', 'Meropenem', 'Pip/Tazo 4,5g c/6h', 'Aciclovir 400mg c/12h', 'Caspofungina', 'Daptomicina', 'Ampicilina-Sulbactam', 'Colistin'],
  qmt: ['Rituximab + EPOCH', 'Ciclo 2', 'Carbo/Etopósido + Atezolizumab', 'FOLFIRI', 'FOLFOX', 'Cisplatino', 'Ciclofosfamida', 'Paclitaxel'],
  otros: ['Filgrastim', 'Bactrim forte', 'Isavuconazol', 'Ceftolozano + Tazobactam', 'Heparina', 'HBPM', 'Omeprazol', 'Dexametasona'],
};

const DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];
const DAY_LABELS = { lunes: 'Lun', martes: 'Mar', miercoles: 'Mié', jueves: 'Jue', viernes: 'Vie' };
const FLOORS = ['3', '4', '5', 'tamo', 'uti', 'utiq'];
const FLOOR_LABELS = { '3': 'Piso 3', '4': 'Piso 4', '5': 'Piso 5', 'tamo': 'TAMO', 'uti': 'UTI', 'utiq': 'UTI-Q' };

// ─── STATE ────────────────────────────────────────────────────────────────────
let app = null;
let auth = null;
let db = null;
let currentUser = null;
let currentWeek = getWeekId(new Date());
let currentFloor = '3';
let allPatients = {};
let weekData = {};
let pendingCSV = [];
let panelState = { hc: null, day: 'lunes', data: {} };
let currentDaysHc = null;
let movePatientHc = null;
let moveFilterFloor = 'all';
let moveSelectedRoom = null;
let isAdmin = false;

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function showLoading(show) {
  const overlay = document.getElementById('loading-overlay');
  if (show) overlay.classList.add('open');
  else overlay.classList.remove('open');
}

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

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 2800);
}

// ─── FIREBASE CONFIG ──────────────────────────────────────────────────────────
async function saveConfig() {
  const cfg = {
    apiKey: document.getElementById('cfg-apiKey').value.trim(),
    authDomain: document.getElementById('cfg-authDomain').value.trim(),
    projectId: document.getElementById('cfg-projectId').value.trim(),
    appId: document.getElementById('cfg-appId').value.trim(),
  };
  if (!cfg.apiKey || !cfg.projectId || !cfg.authDomain) {
    showToast('Completá todos los campos');
    return;
  }
  localStorage.setItem('sc_fb_config', JSON.stringify(cfg));
  await initFirebase(cfg);
}

async function initFirebase(cfg) {
  showLoading(true);
  try {
    app = initializeApp(cfg);
    auth = getAuth(app);
    db = getFirestore(app);
    
    // Verificar si hay usuarios en Firestore, si no, crear admin por defecto
    await ensureAdminUser();
    
    document.getElementById('config-banner').classList.add('hidden');
    showToast('Firebase conectado ✓');
    
    // Escuchar cambios de autenticación
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUser = user;
        isAdmin = user.email === 'admin@seguimiento.com';
        updateUserUI();
        await loadAllData();
        renderAll();
      } else {
        currentUser = null;
        isAdmin = false;
        updateUserUI();
        allPatients = {};
        weekData = {};
        renderAll();
        openLoginModal();
      }
      showLoading(false);
    });
  } catch (e) {
    showLoading(false);
    showToast('Error conectando Firebase: ' + e.message);
  }
}

async function ensureAdminUser() {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', 'admin@seguimiento.com'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      // Crear usuario admin en Auth
      try {
        const userCred = await createUserWithEmailAndPassword(auth, 'admin@seguimiento.com', 'admin123');
        await updateProfile(userCred.user, { displayName: 'Administrador' });
        await setDoc(doc(db, 'users', userCred.user.uid), {
          email: 'admin@seguimiento.com',
          name: 'Administrador',
          role: 'admin',
          createdAt: new Date().toISOString()
        });
        showToast('Usuario admin creado por defecto');
      } catch (e) {
        console.warn('Admin user may already exist:', e.message);
      }
    }
  } catch (e) {
    console.warn('Error ensuring admin user:', e);
  }
}

// ─── DATA LOADING ─────────────────────────────────────────────────────────────
async function loadAllData() {
  if (!db || !currentUser) return;
  showLoading(true);
  try {
    // Cargar pacientes
    const patientsSnap = await getDocs(collection(db, 'patients'));
    allPatients = {};
    patientsSnap.forEach(doc => {
      allPatients[doc.id] = doc.data();
    });
    
    // Cargar semana actual
    const weekDoc = await getDoc(doc(db, 'weeks', currentWeek));
    if (weekDoc.exists()) {
      weekData = weekDoc.data();
    } else {
      weekData = {};
    }
  } catch (e) {
    showToast('Error cargando datos: ' + e.message);
  }
  showLoading(false);
}

async function saveWeekToFirestore() {
  if (!db || !currentUser) return;
  try {
    await setDoc(doc(db, 'weeks', currentWeek), weekData);
    showToast('Semana guardada ✓');
  } catch (e) {
    showToast('Error guardando semana: ' + e.message);
  }
}

async function savePatientToFirestore(hc, data) {
  if (!db || !currentUser) return;
  try {
    await setDoc(doc(db, 'patients', hc), data);
  } catch (e) {
    showToast('Error guardando paciente: ' + e.message);
  }
}

async function deletePatientFromFirestore(hc) {
  if (!db || !currentUser) return;
  try {
    await deleteDoc(doc(db, 'patients', hc));
  } catch (e) {
    showToast('Error eliminando paciente: ' + e.message);
  }
}

async function saveAudit(action, hc, day, details) {
  if (!db || !currentUser) return;
  try {
    await setDoc(doc(db, 'audit', `${Date.now()}_${currentUser.uid}`), {
      timestamp: new Date().toISOString(),
      userId: currentUser.uid,
      userEmail: currentUser.email,
      userName: currentUser.displayName,
      action,
      hc,
      day,
      week: currentWeek,
      details
    });
  } catch (e) {
    console.warn('Audit log error:', e);
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function openLoginModal() {
  document.getElementById('login-modal').classList.add('open');
  document.getElementById('login-email').focus();
}

function closeLoginModal() {
  document.getElementById('login-modal').classList.remove('open');
  document.getElementById('login-email').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('register-card').style.display = 'none';
  document.querySelector('#login-modal .login-card').style.display = 'block';
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (!email || !pass) {
    showToast('Complete email y contraseña');
    return;
  }
  showLoading(true);
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    closeLoginModal();
    showToast('Bienvenido');
  } catch (e) {
    showLoading(false);
    showToast('Error: ' + (e.message === 'Firebase: Error (auth/invalid-credential).' ? 'Credenciales incorrectas' : e.message));
  }
}

async function doRegister() {
  const email = document.getElementById('reg-email').value.trim();
  const name = document.getElementById('reg-name').value.trim();
  const pass = document.getElementById('reg-pass').value;
  const confirm = document.getElementById('reg-pass-confirm').value;
  
  if (!email || !name || !pass) {
    showToast('Complete todos los campos');
    return;
  }
  if (pass !== confirm) {
    showToast('Las contraseñas no coinciden');
    return;
  }
  showLoading(true);
  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(userCred.user, { displayName: name });
    await setDoc(doc(db, 'users', userCred.user.uid), {
      email: email,
      name: name,
      role: 'user',
      createdAt: new Date().toISOString()
    });
    closeLoginModal();
    showToast('Usuario registrado correctamente');
  } catch (e) {
    showLoading(false);
    showToast('Error: ' + e.message);
  }
}

async function logout() {
  await signOut(auth);
  showToast('Sesión cerrada');
}

function updateUserUI() {
  const panel = document.getElementById('user-panel');
  const nameSpan = document.getElementById('user-name-display');
  const adminBtn = document.getElementById('btn-admin-users');
  
  if (currentUser) {
    panel.style.display = 'flex';
    nameSpan.textContent = currentUser.displayName || currentUser.email;
    adminBtn.style.display = isAdmin ? 'flex' : 'none';
  } else {
    panel.style.display = 'none';
    adminBtn.style.display = 'none';
  }
}

// ─── USER MANAGEMENT (ADMIN ONLY) ────────────────────────────────────────────
async function loadUsersList() {
  if (!db || !isAdmin) return [];
  const usersSnap = await getDocs(collection(db, 'users'));
  return usersSnap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
}

async function renderUsersList() {
  const container = document.getElementById('users-list');
  if (!container) return;
  const users = await loadUsersList();
  container.innerHTML = users.map(u => `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border);">
      <div>
        <strong>${u.email}</strong><br>
        <span style="font-size: 11px; color: var(--text3);">${u.name || '—'} ${u.role === 'admin' ? '(Admin)' : ''}</span>
      </div>
      ${u.role !== 'admin' ? `<button class="btn delete-user-btn" data-uid="${u.uid}" style="padding: 4px 8px; background: var(--cat-qmt); color: white; border: none;">Eliminar</button>` : '<span style="font-size:11px;color:var(--text3);">Admin</span>'}
    </div>
  `).join('');
  
  document.querySelectorAll('.delete-user-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      if (confirm('¿Eliminar este usuario?')) {
        await deleteDoc(doc(db, 'users', uid));
        renderUsersList();
        showToast('Usuario eliminado');
      }
    });
  });
}

async function addNewUser() {
  const email = document.getElementById('new-user-email').value.trim();
  const name = document.getElementById('new-user-name').value.trim();
  const pass = document.getElementById('new-user-pass').value;
  
  if (!email || !name || !pass) {
    showToast('Complete todos los campos');
    return;
  }
  showLoading(true);
  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(userCred.user, { displayName: name });
    await setDoc(doc(db, 'users', userCred.user.uid), {
      email: email,
      name: name,
      role: 'user',
      createdAt: new Date().toISOString()
    });
    await renderUsersList();
    document.getElementById('new-user-email').value = '';
    document.getElementById('new-user-name').value = '';
    document.getElementById('new-user-pass').value = '';
    showToast(`Usuario ${email} agregado`);
  } catch (e) {
    showToast('Error: ' + e.message);
  }
  showLoading(false);
}

function openAdminUsersModal() {
  if (!isAdmin) {
    showToast('Solo administradores');
    return;
  }
  renderUsersList();
  document.getElementById('admin-users-overlay').classList.add('open');
}

function closeAdminUsersModal() {
  document.getElementById('admin-users-overlay').classList.remove('open');
}

// ─── WEEK NAVIGATION ─────────────────────────────────────────────────────────
async function changeWeek(dir) {
  const [y, wn] = currentWeek.replace('W', '').split('-').map(Number);
  const jan4 = new Date(y, 0, 4);
  const startOfWeek = new Date(jan4);
  startOfWeek.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7 + (wn - 1) * 7 + dir * 7);
  currentWeek = getWeekId(startOfWeek);
  await loadAllData();
  renderAll();
}

function updateWeekLabel() {
  const dates = getWeekDates(currentWeek);
  const shortId = currentWeek.replace('-', ' ');
  document.getElementById('week-label').innerHTML = `${shortId} <span class="week-dates">· ${dates}</span>`;
}

// ─── FLOOR FUNCTIONS ─────────────────────────────────────────────────────────
function getPatientCountForFloor(f) {
  const numericFloors = ['3', '4', '5'];
  return Object.values(allPatients).filter(p => {
    if (numericFloors.includes(f)) return String(p.cama).startsWith(f) && String(p.cama).length === 3;
    return (p.floor || '').toLowerCase() === f.toLowerCase();
  }).length;
}

function renderFloorTabs() {
  const el = document.getElementById('floor-tabs');
  el.innerHTML = FLOORS.map(f => {
    const count = getPatientCountForFloor(f);
    const countBadge = count > 0 ? `<span style="background:rgba(255,255,255,0.25);border-radius:10px;padding:0 5px;font-size:10px;margin-left:4px;">${count}</span>` : '';
    return `<button class="floor-tab ${f === currentFloor ? 'active' : ''}" data-floor="${f}">${FLOOR_LABELS[f] || f}${countBadge}</button>`;
  }).join('');
}

function selectFloor(f) {
  currentFloor = f;
  renderTable();
  renderFloorTabs();
}

// ─── PATIENT TABLE RENDERING ─────────────────────────────────────────────────
function getFloorPatients() {
  const numericFloors = ['3', '4', '5'];
  return Object.values(allPatients)
    .filter(p => {
      if (numericFloors.includes(currentFloor)) {
        return String(p.cama).startsWith(currentFloor) && String(p.cama).length === 3;
      } else {
        return (p.floor || '').toLowerCase() === currentFloor.toLowerCase();
      }
    })
    .sort((a, b) => String(a.cama).localeCompare(String(b.cama)));
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
        <td><div class="cell-patient-name">${p.paciente}</div><div class="cell-sub">HC ${p.hc}${p.ingreso ? ' · Ing. ' + p.ingreso : ''}</div></td>
        <td><div style="font-size:12px;color:var(--text2)">${p.medico || '—'}</div><div class="cell-sub">${(p.cobertura || '').split(' - ')[0]}</div></td>
        <td><span class="cell-diag">${p.diagnostico || '—'}</span></td>
        <td style="text-align:right;padding-right:16px;" class="btn-action-td"><button class="btn discharge-btn" data-hc="${hc}" style="padding:4px 10px;font-size:11px;">Alta</button></td>
      </tr>
      <tr class="days-row" id="days-row-${hc}" style="display:none;"><td colspan="5" style="padding:0;background:var(--surface2);"><div class="days-row-content" id="days-content-${hc}"></div></td></tr>`;
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
        <div class="mobile-card-top"><div class="cell-room" style="font-size:14px;min-width:42px">${p.cama}</div><div style="flex:1;min-width:0;"><div class="cell-patient-name" style="font-size:13px;">${p.paciente}</div><div class="cell-sub">HC ${p.hc}${p.ingreso ? ' · Ing. ' + p.ingreso : ''}</div></div><button class="btn mobile-discharge-btn" data-hc="${hc}" style="padding:4px 8px;font-size:10px;">Alta</button></div>
        ${hasSomeData ? `<div class="mobile-card-days">${DAYS.map(d => {
          const entry = weekData[`${hc}_${d}`];
          const cats = CATS.filter(c => entry?.[c.id] && (entry[c.id].tags?.length || entry[c.id].text));
          const hasData = cats.length > 0;
          return `<span class="mobile-day-pill ${hasData ? 'has-data' : ''}" data-hc="${hc}" data-day="${d}">${DAY_LABELS[d]}${hasData ? ` (${cats.length})` : ''}</span>`;
        }).join('')}</div>` : `<div class="mobile-card-hint">Tocá para cargar medicación →</div>`}
        <div class="mobile-card-diag">${p.diagnostico || ''}</div>
      </div>`;
  }).join('');

  // Attach event listeners
  document.querySelectorAll('.patient-row').forEach(row => {
    row.addEventListener('click', () => handlePatientRowClick(row.dataset.hc));
  });
  document.querySelectorAll('.discharge-btn, .mobile-discharge-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dischargePatient(btn.dataset.hc);
    });
  });
  document.querySelectorAll('.mobile-card').forEach(card => {
    card.addEventListener('click', () => handlePatientRowClick(card.dataset.hc));
  });
  document.querySelectorAll('.mobile-day-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      openPanel(pill.dataset.hc, pill.dataset.day);
    });
  });
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
        parts.push(`<span style="font-size:8px;color:var(--text3);border-top:1px solid var(--border);margin-top:4px;padding-top:4px;">✎ ${entry._lastModifiedBy}</span>`);
      }
      summary = parts.join('<br>');
    }
    return `<button class="days-row-card ${hasEntry ? 'has-data' : ''}" data-hc="${hc}" data-day="${day}"><div class="days-row-card-header"><span class="days-row-day">${DAY_LABELS[day]}</span><div class="day-badges">${renderDayBadges(hc, day)}</div></div><div class="days-row-summary">${summary}</div></button>`;
  }).join('');
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px 4px;border-bottom:1px solid var(--border);background:var(--surface);"><span style="font-size:11px;color:var(--text3);">Semana ${currentWeek}</span><button class="btn move-patient-btn" data-hc="${hc}" style="padding:3px 10px;font-size:11px;">Mover cama</button></div><div class="days-row-cards-grid">${dayCards}</div>`;
  
  container.querySelectorAll('.days-row-card').forEach(card => {
    card.addEventListener('click', () => openPanel(card.dataset.hc, card.dataset.day));
  });
  container.querySelectorAll('.move-patient-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMovePatient(btn.dataset.hc);
    });
  });
}

// ─── ENTRY PANEL ─────────────────────────────────────────────────────────────
function openPanel(hc, day) {
  if (!currentUser) return;
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
  el.innerHTML = DAYS.map(d =>
    `<button class="day-btn ${d === panelState.day ? 'active' : ''}" data-day="${d}">${DAY_LABELS[d]}</button>`
  ).join('');
  document.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPanelDay(btn.dataset.day));
  });
  updateCopyPrevBtn();
}

function updateCopyPrevBtn() {
  const btn = document.getElementById('btn-copy-prev');
  const idx = DAYS.indexOf(panelState.day);
  btn.disabled = idx === 0;
  btn.style.opacity = idx === 0 ? '0.4' : '';
  btn.style.cursor = idx === 0 ? 'not-allowed' : '';
}

function switchPanelDay(day) {
  collectPanelData();
  const currentKey = `${panelState.hc}_${panelState.day}`;
  weekData[currentKey] = panelState.data;
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
        <div class="cat-header" data-cat="${cat.id}"><div class="cat-dot" style="background:${cat.dot}"></div><span class="cat-label" style="color:${cat.dot}">${cat.label}</span><span class="cat-summary" id="cat-sum-${cat.id}">${summary}</span><span class="cat-toggle">▾</span></div>
        <div class="cat-body" id="cat-body-${cat.id}" style="${activeTags.length || text ? '' : 'display:none'}">
          <div class="tags-row">${tags.map(t => `<button class="tag-chip ${cat.cls} ${activeTags.includes(t) ? 'active' : ''}" data-cat="${cat.id}" data-tag="${t.replace(/'/g, "\\'")}">${t}</button>`).join('')}</div>
          <textarea class="cat-textarea" id="ta-${cat.id}" data-cat="${cat.id}" placeholder="Notas adicionales de ${cat.label.toLowerCase()}...">${text}</textarea>
        </div>
      </div>`;
  }).join('');
  
  document.querySelectorAll('.cat-header').forEach(header => {
    header.addEventListener('click', () => toggleCat(header.dataset.cat));
  });
  document.querySelectorAll('.tag-chip').forEach(btn => {
    btn.addEventListener('click', () => toggleTag(btn.dataset.cat, btn.dataset.tag, btn));
  });
  document.querySelectorAll('.cat-textarea').forEach(ta => {
    ta.addEventListener('input', () => updateCatSummary(ta.dataset.cat));
  });
}

function toggleCat(catId) {
  const body = document.getElementById(`cat-body-${catId}`);
  body.style.display = body.style.display === 'none' ? '' : 'none';
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
    currentText = currentText.trim() ? currentText + '\n' + tag : tag;
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

async function saveEntry() {
  if (!currentUser) return;
  collectPanelData();
  const key = `${panelState.hc}_${panelState.day}`;
  const wasExisting = !!weekData[key];
  panelState.data._lastModifiedBy = currentUser.displayName || currentUser.email;
  panelState.data._lastModifiedAt = new Date().toISOString();
  weekData[key] = panelState.data;
  await saveWeekToFirestore();
  await saveAudit(wasExisting ? 'modify' : 'create', panelState.hc, panelState.day, {});
  const savedHc = panelState.hc;
  closePanel();
  await loadAllData();
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

async function copyToPrevDay() {
  const idx = DAYS.indexOf(panelState.day);
  if (idx <= 0) {
    showToast('No hay día anterior');
    return;
  }
  const prevDay = DAYS[idx - 1];
  const prevKey = `${panelState.hc}_${prevDay}`;
  const prevData = weekData[prevKey];
  const hasPrevData = prevData && CATS.some(c => prevData[c.id] && (prevData[c.id].text || prevData[c.id].tags?.length));
  if (!hasPrevData) {
    showToast(`El ${DAY_LABELS[prevDay]} no tiene datos`);
    return;
  }
  panelState.data = JSON.parse(JSON.stringify(prevData));
  const currentKey = `${panelState.hc}_${panelState.day}`;
  weekData[currentKey] = panelState.data;
  await saveWeekToFirestore();
  renderPanelBody();
  showToast(`Datos copiados desde ${DAY_LABELS[prevDay]}`);
}

function closePanel() {
  document.getElementById('entry-overlay').classList.remove('open');
  document.getElementById('entry-panel').classList.remove('open');
}

// ─── CSV IMPORT ─────────────────────────────────────────────────────────────
function openCSV() { document.getElementById('csv-overlay').classList.add('open'); }
function closeCSV() { document.getElementById('csv-overlay').classList.remove('open'); pendingCSV = []; document.getElementById('csv-preview').style.display = 'none'; document.getElementById('btn-import').disabled = true; }

function parseCSV(text) {
  const patients = [];
  const lines = text.split(/\r?\n/);
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // El formato del CSV es especial: toda la línea está entre comillas dobles externas
    // y las comillas internas están escapadas como ""
    // Primero quitamos las comillas externas si existen
    let cleanLine = line.trim();
    if (cleanLine.startsWith('"') && cleanLine.endsWith('"')) {
      cleanLine = cleanLine.substring(1, cleanLine.length - 1);
    }
    
    // Ahora parseamos los campos internos, reemplazando "" por un marcador temporal
    // para evitar confundirlos con comillas de cierre
    const fields = [];
    let current = '';
    let i = 0;
    let inQuotes = false;
    
    while (i < cleanLine.length) {
      const char = cleanLine[i];
      const nextChar = cleanLine[i + 1];
      
      if (char === '"') {
        if (nextChar === '"') {
          // Comillas escapadas "" se convierten en una comilla simple
          current += '"';
          i += 2;
          continue;
        } else {
          // Inicio o fin de campo entre comillas
          inQuotes = !inQuotes;
          i++;
          continue;
        }
      }
      
      if (char === ',' && !inQuotes) {
        fields.push(current);
        current = '';
        i++;
        continue;
      }
      
      current += char;
      i++;
    }
    fields.push(current);
    
    // Limpiar campos: quitar comillas dobles externas si existen
    const cleanFields = fields.map(f => {
      let cleaned = f.trim();
      // Quitar comillas dobles al inicio y fin del campo
      if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.substring(1, cleaned.length - 1);
      }
      return cleaned.trim();
    });
    
    // Buscar el índice donde comienzan los datos reales
    // Los datos están después de campos como "PISO 3", "Cama", "Paciente", etc.
    let dataStartIndex = -1;
    let pisoValue = '';
    
    for (let idx = 0; idx < cleanFields.length; idx++) {
      const field = cleanFields[idx];
      // Detectar el encabezado del piso (debe coincidir exactamente)
      if (field === 'PISO 3' || field === 'PISO 4' || field === 'PISO 5' || 
          field === 'TAMO' || field === 'U.T.I    PISO 4' || field === 'U.T.I.Q  PISO2') {
        pisoValue = field;
      }
      // Detectar el inicio de los datos (después de "Diagnóstico")
      if (field === 'Diagnóstico') {
        dataStartIndex = idx + 1;
        break;
      }
    }
    
    // Si encontramos dónde empiezan los datos y hay suficientes campos
    if (dataStartIndex !== -1 && cleanFields.length > dataStartIndex + 5) {
      // Extraer los datos según las posiciones conocidas
      // Orden: Cama, Paciente, HC, Medico, Ingreso, Dias, Cobertura, Servicio, Diagnóstico, Credencial
      const cama = cleanFields[dataStartIndex] || '';
      const paciente = cleanFields[dataStartIndex + 1] || '';
      const hcRaw = cleanFields[dataStartIndex + 2] || '';
      const hc = hcRaw.replace('.0', '').trim();
      const medico = cleanFields[dataStartIndex + 3] || '—';
      const ingreso = cleanFields[dataStartIndex + 4] || '';
      const dias = cleanFields[dataStartIndex + 5] || '0';
      const cobertura = cleanFields[dataStartIndex + 6] || '—';
      const servicio = cleanFields[dataStartIndex + 7] || '—';
      const diagnostico = cleanFields[dataStartIndex + 8] || 'SIN DIAGNÓSTICO';
      
      // Determinar el piso
      let floor = '';
      if (pisoValue === 'PISO 3') floor = '3';
      else if (pisoValue === 'PISO 4') floor = '4';
      else if (pisoValue === 'PISO 5') floor = '5';
      else if (pisoValue === 'TAMO') floor = 'tamo';
      else if (pisoValue === 'U.T.I    PISO 4') floor = 'uti';
      else if (pisoValue === 'U.T.I.Q  PISO2') floor = 'utiq';
      
      // Si no se detectó por el encabezado, usar la cama o servicio
      if (!floor) {
        if (servicio.includes('TAMO')) floor = 'tamo';
        else if (servicio.includes('U.T.I.Q')) floor = 'utiq';
        else if (servicio.includes('U.T.I')) floor = 'uti';
        else if (cama.startsWith('3')) floor = '3';
        else if (cama.startsWith('4')) floor = '4';
        else if (cama.startsWith('5')) floor = '5';
        else floor = '3';
      }
      
      // Validar que tengamos datos mínimos
      if (cama && paciente && hc && !isNaN(parseInt(hc)) && parseInt(hc) > 0) {
        // Evitar duplicados por HC
        if (!patients.find(p => p.hc === hc)) {
          patients.push({
            cama: cama,
            hc: hc,
            paciente: paciente,
            medico: medico,
            ingreso: ingreso,
            dias: dias,
            cobertura: cobertura,
            servicio: servicio,
            diagnostico: diagnostico,
            floor: floor,
          });
        }
      }
    }
  }
  
  console.log('Pacientes encontrados:', patients.length);
  return patients;
}

// Función auxiliar para parsear líneas CSV respetando comillas
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Comillas dobles escapadas
        current += '"';
        i++;
      } else {
        // Alternar estado de comillas
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Fin de campo
      result.push(current);
      current = '';
    } else {
      current += char;
    }
    i++;
  }
  
  // Agregar último campo
  result.push(current);
  
  return result;
}

function showCSVPreview(patients) {
  const el = document.getElementById('csv-preview');
  if (!patients.length) { el.style.display = 'none'; showToast('No se encontraron pacientes'); return; }
  el.style.display = 'flex';
  el.innerHTML = `<div class="preview-info"><span>${patients.length} pacientes encontrados</span></div><div class="preview-list">${patients.map(p => `<div class="preview-row"><span class="pr-room">${p.cama}</span><span class="pr-name">${p.paciente}</span></div>`).join('')}</div>`;
  document.getElementById('btn-import').disabled = false;
}

async function importPatients() {
  if (!pendingCSV.length) return;
  showLoading(true);
  for (const p of pendingCSV) {
    allPatients[p.hc] = p;
    await savePatientToFirestore(p.hc, p);
  }
  await saveAudit('import', null, null, { count: pendingCSV.length });
  closeCSV();
  await loadAllData();
  renderTable();
  renderFloorTabs();
  showLoading(false);
  showToast(`${pendingCSV.length} pacientes importados ✓`);
  pendingCSV = [];
}

function readCSVFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => { pendingCSV = parseCSV(e.target.result); showCSVPreview(pendingCSV); };
  reader.readAsText(file, 'latin1');
}

// ─── ADD PATIENT ────────────────────────────────────────────────────────────
function openAddPatientModal() { document.getElementById('add-patient-overlay').classList.add('open'); }
function closeAddPatientModal() { document.getElementById('add-patient-overlay').classList.remove('open'); document.getElementById('add-patient-form').reset(); }

function detectFloor(cama, servicio = '') {
  const s = String(cama);
  const servUpper = String(servicio).toUpperCase();
  if (servUpper.includes('TAMO')) return 'tamo';
  if (servUpper.includes('U.T.I.Q') || servUpper.includes('UTIQ')) return 'utiq';
  if (servUpper.includes('U.T.I') || servUpper.includes('UTI')) return 'uti';
  if (s.startsWith('3') && s.length === 3) return '3';
  if (s.startsWith('4') && s.length === 3) return '4';
  if (s.startsWith('5') && s.length === 3) return '5';
  return s.charAt(0);
}

async function saveNewPatient() {
  if (!currentUser) return;
  const cama = document.getElementById('new-cama').value.trim();
  const paciente = document.getElementById('new-paciente').value.trim();
  const hc = document.getElementById('new-hc').value.trim();
  const medico = document.getElementById('new-medico').value.trim();
  const cobertura = document.getElementById('new-cobertura').value.trim();
  const ingreso = document.getElementById('new-ingreso').value;
  const dias = document.getElementById('new-dias').value;
  const servicio = document.getElementById('new-servicio').value.trim();
  const diagnostico = document.getElementById('new-diagnostico').value.trim();
  if (!cama || !paciente || !hc) { showToast('Complete los campos obligatorios'); return; }
  if (allPatients[hc]) { showToast('HC ya existe'); return; }
  const floor = detectFloor(cama, servicio);
  const newPatient = { cama, hc, paciente, medico: medico || '—', cobertura: cobertura || '—', ingreso: ingreso || '—', dias: dias || '0', servicio: servicio || '—', diagnostico: diagnostico || 'SIN DIAGNÓSTICO', floor };
  allPatients[hc] = newPatient;
  await savePatientToFirestore(hc, newPatient);
  await saveAudit('create', hc, null, { paciente, cama });
  closeAddPatientModal();
  renderTable();
  renderFloorTabs();
  showToast('Paciente agregado ✓');
}

// ─── PATIENT DAYS VIEW ──────────────────────────────────────────────────────
function openPatientDays(hc) {
  const p = allPatients[hc];
  if (!p) return;
  currentDaysHc = hc;
  document.getElementById('days-patient-name').textContent = p.paciente;
  document.getElementById('days-patient-meta').textContent = `Cama ${p.cama} · HC ${p.hc}`;
  renderPatientDaysList();
  document.getElementById('patient-days-overlay').classList.add('open');
  setTimeout(() => document.getElementById('patient-days-panel').classList.add('open'), 10);
}

function closePatientDays() {
  document.getElementById('patient-days-panel').classList.remove('open');
  setTimeout(() => document.getElementById('patient-days-overlay').classList.remove('open'), 250);
}

function renderPatientDaysList() {
  const el = document.getElementById('patient-days-list');
  el.innerHTML = DAYS.map(day => {
    const entry = weekData[`${currentDaysHc}_${day}`];
    const hasEntry = entry && CATS.some(c => entry[c.id] && (entry[c.id].text || entry[c.id].tags?.length));
    if (!hasEntry) return `<div class="day-list-item" data-day="${day}"><div class="day-list-header"><span class="day-list-day">${DAY_LABELS[day]}</span><span class="day-list-empty">Sin datos</span></div></div>`;
    const badges = CATS.filter(c => entry[c.id] && (entry[c.id].text || entry[c.id].tags?.length)).map(c => `<span class="badge ${c.cls}">${c.label.substring(0, 3).toUpperCase()}</span>`).join('');
    const summaries = [];
    CATS.forEach(c => { const d = entry[c.id]; if (d) { if (d.tags?.length) summaries.push(`${c.label}: ${d.tags.join(', ')}`); else if (d.text) summaries.push(`${c.label}: ${d.text.substring(0, 30)}...`); } });
    if (entry._lastModifiedBy) summaries.push(`👤 ${entry._lastModifiedBy}`);
    return `<div class="day-list-item" data-day="${day}"><div class="day-list-header"><span class="day-list-day">${DAY_LABELS[day]}</span><div class="day-list-badges">${badges}</div></div><div class="day-list-summary">${summaries.join('<br>')}</div></div>`;
  }).join('');
  document.querySelectorAll('#patient-days-list .day-list-item').forEach(item => {
    item.addEventListener('click', () => openPanel(currentDaysHc, item.dataset.day));
  });
}

function addDayEntry() {
  if (!currentDaysHc) return;
  const dayMap = { 1: 'lunes', 2: 'martes', 3: 'miercoles', 4: 'jueves', 5: 'viernes' };
  openPanel(currentDaysHc, dayMap[new Date().getDay()] || 'lunes');
}

// ─── DISCHARGE ───────────────────────────────────────────────────────────────
async function dischargePatient(hc) {
  const p = allPatients[hc];
  if (!p || !confirm(`¿Dar de alta a ${p.paciente}?`)) return;
  showLoading(true);
  const dischargeRecord = { ...p, dischargedAt: new Date().toISOString(), dischargedBy: currentUser.email, dischargeWeek: currentWeek };
  await setDoc(doc(db, 'discharges', `${hc}_${Date.now()}`), dischargeRecord);
  await deletePatientFromFirestore(hc);
  delete allPatients[hc];
  for (const day of DAYS) delete weekData[`${hc}_${day}`];
  await saveWeekToFirestore();
  await saveAudit('delete', hc, null, { action: 'discharge' });
  await loadAllData();
  renderTable();
  renderFloorTabs();
  showLoading(false);
  showToast(`${p.paciente} dado de alta ✓`);
}

// ─── MOVE PATIENT ────────────────────────────────────────────────────────────
function openMovePatient(hc) {
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
  renderMoveFloorFilter();
  renderMoveGrid();
  document.getElementById('move-patient-overlay').classList.add('open');
}

function renderMoveFloorFilter() {
  const filterEl = document.getElementById('move-floor-filter');
  filterEl.innerHTML = [FLOORS.map(f => `<button class="move-floor-btn" data-floor="${f}">${FLOOR_LABELS[f]}</button>`).join('')];
  document.querySelectorAll('.move-floor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      moveFilterFloor = btn.dataset.floor;
      document.querySelectorAll('.move-floor-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderMoveGrid();
    });
  });
}

function renderMoveGrid() {
  const search = document.getElementById('move-search')?.value.toLowerCase() || '';
  const grid = document.getElementById('move-bed-grid');
  const rooms = Object.values(allPatients).filter(pat => {
    if (pat.hc === movePatientHc) return false;
    if (moveFilterFloor !== 'all') {
      if (moveFilterFloor === '3' || moveFilterFloor === '4' || moveFilterFloor === '5') {
        if (!String(pat.cama).startsWith(moveFilterFloor)) return false;
      } else {
        if ((pat.floor || '').toLowerCase() !== moveFilterFloor) return false;
      }
    }
    if (search && !String(pat.cama).includes(search) && !pat.paciente.toLowerCase().includes(search)) return false;
    return true;
  }).sort((a, b) => String(a.cama).localeCompare(String(b.cama)));
  grid.innerHTML = rooms.map(pat => `<div class="bed-card occupied" data-room="${pat.cama}"><div class="bed-card-room">${pat.cama}</div><div class="bed-card-name">${pat.paciente.split(',')[0]}</div><div class="bed-card-status busy">● Ocupada</div></div>`).join('');
  document.querySelectorAll('.bed-card').forEach(card => {
    card.addEventListener('click', () => {
      moveSelectedRoom = card.dataset.room;
      document.querySelectorAll('.bed-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      document.getElementById('new-move-room').value = '';
    });
  });
}

function closeMovePatientModal() { document.getElementById('move-patient-overlay').classList.remove('open'); }

async function confirmMovePatient() {
  const newRoom = moveSelectedRoom || document.getElementById('new-move-room').value.trim();
  if (!newRoom) { showToast('Seleccioná una cama'); return; }
  const p = allPatients[movePatientHc];
  if (!p) return;
  const oldRoom = p.cama;
  const existing = Object.values(allPatients).find(pat => pat.cama === newRoom && pat.hc !== movePatientHc);
  if (existing) {
    if (!confirm(`La cama ${newRoom} está ocupada por ${existing.paciente}. ¿Intercambiar?`)) return;
    existing.cama = oldRoom;
    existing.floor = detectFloor(oldRoom, existing.servicio);
    await savePatientToFirestore(existing.hc, existing);
  }
  p.cama = newRoom;
  p.floor = detectFloor(newRoom, p.servicio);
  await savePatientToFirestore(movePatientHc, p);
  await saveAudit('modify', movePatientHc, null, { action: 'move', from: oldRoom, to: newRoom });
  await loadAllData();
  closeMovePatientModal();
  renderTable();
  showToast(`Paciente movido de ${oldRoom} a ${newRoom}`);
}

// ─── HISTORY VIEW ────────────────────────────────────────────────────────────
function toggleView(view) {
  document.getElementById('view-main').style.display = view === 'main' ? 'block' : 'none';
  document.getElementById('view-history').style.display = view === 'history' ? 'block' : 'none';
  if (view === 'history') searchHistory();
}

async function searchHistory() {
  if (!db) return;
  const patQ = document.getElementById('hist-search-patient').value.toLowerCase();
  const drugQ = document.getElementById('hist-search-drug').value.toLowerCase();
  const weekQ = document.getElementById('hist-search-week').value;
  const weeksSnap = await getDocs(collection(db, 'weeks'));
  const results = [];
  for (const weekDoc of weeksSnap.docs) {
    const wid = weekDoc.id;
    if (weekQ && wid !== weekQ) continue;
    const data = weekDoc.data();
    for (const [key, dayData] of Object.entries(data)) {
      const hc = key.split('_')[0];
      const patient = allPatients[hc];
      if (!patient) continue;
      if (patQ && !patient.paciente.toLowerCase().includes(patQ)) continue;
      let drugMatch = !drugQ;
      if (drugQ) {
        for (const cat of CATS) {
          const cd = dayData[cat.id];
          if (cd && ((cd.text || '').toLowerCase().includes(drugQ) || (cd.tags || []).some(t => t.toLowerCase().includes(drugQ)))) {
            drugMatch = true;
            break;
          }
        }
      }
      if (drugMatch) results.push({ wid, patient, dayData });
    }
  }
  renderHistoryResults(results);
}

function renderHistoryResults(results) {
  const el = document.getElementById('history-results');
  if (!results.length) { el.innerHTML = '<div class="no-data"><p>Sin resultados</p></div>'; return; }
  el.innerHTML = results.map(r => `<div class="hist-card"><div class="hist-card-header">${r.patient.paciente} - ${r.wid}</div><div class="hist-card-body">${JSON.stringify(r.dayData)}</div></div>`).join('');
}

// ─── HANDLE PATIENT ROW CLICK ────────────────────────────────────────────────
function handlePatientRowClick(hc) {
  if (window.innerWidth <= 640) openPatientDays(hc);
  else toggleDaysRow(hc);
}

// ─── FILTER PATIENTS ─────────────────────────────────────────────────────────
function filterPatients(q) { renderTable(q); }

// ─── SAVE WEEK ───────────────────────────────────────────────────────────────
async function saveWeek() { await saveWeekToFirestore(); }

// ─── RENDER ALL ──────────────────────────────────────────────────────────────
function renderAll() {
  updateWeekLabel();
  renderFloorTabs();
  renderTable();
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  updateWeekLabel();
  renderFloorTabs();
  updateUserUI();
  
  const saved = localStorage.getItem('sc_fb_config');
  if (saved) {
    try { await initFirebase(JSON.parse(saved)); } catch(e) { showToast('Error cargando configuración'); }
  }
}

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────
document.getElementById('prev-week').addEventListener('click', () => changeWeek(-1));
document.getElementById('next-week').addEventListener('click', () => changeWeek(1));
document.getElementById('btn-csv').addEventListener('click', () => openCSV());
document.getElementById('btn-history').addEventListener('click', () => toggleView('history'));
document.getElementById('btn-back-main').addEventListener('click', () => toggleView('main'));
document.getElementById('btn-save-week').addEventListener('click', () => saveWeek());
document.getElementById('btn-add-patient').addEventListener('click', () => openAddPatientModal());
document.getElementById('btn-save-config').addEventListener('click', () => saveConfig());
document.getElementById('btn-login').addEventListener('click', () => doLogin());
document.getElementById('btn-cancel-login').addEventListener('click', () => closeLoginModal());
document.getElementById('btn-logout').addEventListener('click', () => logout());
document.getElementById('btn-admin-users').addEventListener('click', () => openAdminUsersModal());
document.getElementById('close-admin-users').addEventListener('click', () => closeAdminUsersModal());
document.getElementById('btn-add-user').addEventListener('click', () => addNewUser());
document.getElementById('search-input').addEventListener('input', (e) => filterPatients(e.target.value));
document.getElementById('entry-overlay').addEventListener('click', (e) => { if (e.target === document.getElementById('entry-overlay')) closePanel(); });
document.getElementById('panel-close').addEventListener('click', () => closePanel());
document.getElementById('panel-cancel').addEventListener('click', () => closePanel());
document.getElementById('btn-copy-prev').addEventListener('click', () => copyToPrevDay());
document.getElementById('panel-save').addEventListener('click', () => saveEntry());
document.getElementById('close-add-patient').addEventListener('click', () => closeAddPatientModal());
document.getElementById('cancel-add-patient').addEventListener('click', () => closeAddPatientModal());
document.getElementById('confirm-add-patient').addEventListener('click', () => saveNewPatient());
document.getElementById('close-move-patient').addEventListener('click', () => closeMovePatientModal());
document.getElementById('cancel-move-patient').addEventListener('click', () => closeMovePatientModal());
document.getElementById('confirm-move-patient').addEventListener('click', () => confirmMovePatient());
document.getElementById('close-patient-days').addEventListener('click', () => closePatientDays());
document.getElementById('close-days-panel').addEventListener('click', () => closePatientDays());
document.getElementById('days-panel-move').addEventListener('click', () => { if (currentDaysHc) openMovePatient(currentDaysHc); });
document.getElementById('days-panel-discharge').addEventListener('click', () => { if (currentDaysHc) dischargePatient(currentDaysHc); });
document.getElementById('btn-add-day-entry').addEventListener('click', () => addDayEntry());
document.getElementById('close-csv').addEventListener('click', () => closeCSV());
document.getElementById('cancel-csv').addEventListener('click', () => closeCSV());
document.getElementById('btn-import').addEventListener('click', () => importPatients());
document.getElementById('hist-search-patient').addEventListener('input', () => searchHistory());
document.getElementById('hist-search-drug').addEventListener('input', () => searchHistory());
document.getElementById('hist-search-week').addEventListener('input', () => searchHistory());

const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('click', () => document.getElementById('file-input').click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); readCSVFile(e.dataTransfer.files[0]); });
document.getElementById('file-input').addEventListener('change', (e) => { if (e.target.files[0]) readCSVFile(e.target.files[0]); });

// Register/login toggle
document.getElementById('btn-show-register').addEventListener('click', (e) => {
  e.preventDefault();
  document.querySelector('#login-modal .login-card').style.display = 'none';
  document.getElementById('register-card').style.display = 'block';
});
document.getElementById('btn-back-login').addEventListener('click', () => {
  document.getElementById('register-card').style.display = 'none';
  document.querySelector('#login-modal .login-card').style.display = 'block';
});
document.getElementById('btn-register').addEventListener('click', () => doRegister());

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('entry-panel').classList.contains('open')) closePanel();
  else if (document.getElementById('move-patient-overlay').classList.contains('open')) closeMovePatientModal();
  else if (document.getElementById('add-patient-overlay').classList.contains('open')) closeAddPatientModal();
  else if (document.getElementById('csv-overlay').classList.contains('open')) closeCSV();
  else if (document.getElementById('patient-days-overlay').classList.contains('open')) closePatientDays();
  else if (currentDaysHc) { document.getElementById(`days-row-${currentDaysHc}`).style.display = 'none'; currentDaysHc = null; }
});

init();