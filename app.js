// ─── IMPORTS ──────────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

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

// ─── USERS & AUDIT ──────────────────────────────────────────────────────────
const VALID_USERS = [
  { user: 'admin', pass: 'admin123', name: 'Administrador' },
  { user: 'doctor', pass: 'doctor123', name: 'Dr. García' },
  { user: 'enfermero', pass: 'nurse123', name: 'Enf. Rodríguez' },
];
let currentUser = JSON.parse(localStorage.getItem('sc_current_user') || 'null');
let auditLog = JSON.parse(localStorage.getItem('sc_audit_log') || '[]');

function saveAudit(action, hc, day, details) {
  const entry = {
    timestamp: new Date().toISOString(),
    user: currentUser?.name || 'anónimo',
    userId: currentUser?.user || 'anonymous',
    action,
    hc,
    day,
    week: currentWeek,
    details,
  };
  auditLog.unshift(entry);
  if (auditLog.length > 1000) auditLog.pop();
  localStorage.setItem('sc_audit_log', JSON.stringify(auditLog));
  if (db) {
    try {
      setDoc(doc(db, 'audit', `${Date.now()}_${hc}_${day}`), entry).catch(() => { });
    } catch (e) { }
  }
}

function requireAuth() {
  if (!currentUser) {
    openLoginModal();
    return false;
  }
  return true;
}

function openLoginModal() {
  document.getElementById('login-modal').classList.add('open');
  document.getElementById('login-user').focus();
}

function closeLoginModal() {
  document.getElementById('login-modal').classList.remove('open');
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}

function doLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  const found = VALID_USERS.find(u => u.user === user && u.pass === pass);
  if (found) {
    currentUser = { user: found.user, name: found.name };
    localStorage.setItem('sc_current_user', JSON.stringify(currentUser));
    updateUserUI();
    closeLoginModal();
    saveAudit('login', null, null, `Usuario ${found.name} inició sesión`);
    showToast(`Bienvenido, ${found.name}`);
    renderAll();
  } else {
    showToast('Usuario o contraseña incorrectos');
  }
}

function logout() {
  saveAudit('logout', null, null, `Usuario ${currentUser?.name} cerró sesión`);
  currentUser = null;
  localStorage.removeItem('sc_current_user');
  updateUserUI();
  showToast('Sesión cerrada');
  renderAll();
}

function updateUserUI() {
  const panel = document.getElementById('user-panel');
  const nameSpan = document.getElementById('user-name-display');
  if (currentUser) {
    panel.style.display = 'flex';
    nameSpan.textContent = currentUser.name;
  } else {
    panel.style.display = 'none';
  }
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

async function saveConfig() {
  const cfg = {
    apiKey: document.getElementById('cfg-apiKey').value.trim(),
    authDomain: document.getElementById('cfg-authDomain').value.trim(),
    projectId: document.getElementById('cfg-projectId').value.trim(),
    appId: document.getElementById('cfg-appId').value.trim(),
  };
  if (!cfg.apiKey || !cfg.projectId) {
    showToast('Completá al menos apiKey y projectId');
    return;
  }
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
    db = getFirestore(app);
    document.getElementById('config-banner').classList.add('hidden');
    showToast('Firebase conectado ✓');
    await loadWeekFromFirestore();
    renderAll();
  } catch (e) {
    showToast('Error conectando Firebase: ' + e.message);
  }
}

async function loadWeekFromFirestore() {
  if (!db) return;
  try {
    const snap = await getDoc(doc(db, 'weeks', currentWeek));
    if (snap.exists()) weekData = snap.data();
    const pSnap = await getDocs(collection(db, 'patients'));
    pSnap.forEach(d => { allPatients[d.id] = d.data(); });
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

// ─── PATIENTS TABLE ───────────────────────────────────────────────────────────
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
          <span class="days-row-day">${DAY_LABELS[day]}</span>
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
          <span class="cat-toggle">▾</span>
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

  panelState.data._lastModifiedBy = currentUser?.name || 'anónimo';
  panelState.data._lastModifiedAt = new Date().toISOString();
  panelState.data._lastWeek = currentWeek;

  weekData[key] = panelState.data;
  localStorage.setItem(`sc_week_${currentWeek}`, JSON.stringify(weekData));

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
  const patients = [];
  const re = /["']?(\d{3})["']?\s*,\s*["']?([\w,\s\.ÑÁÉÍÓÚÜ\/\-]+?)["']?\s*,\s*["']?(\d+\.?\d*)["']?\s*,\s*["']?([\w\s\'`ÁÉÍÓÚÜ]+?)["']?\s*,\s*["']?(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})["']?\s*,\s*["']?(\d+)["']?\s*,\s*["']?(.*?)["']?\s*,\s*["']?(.*?)["']?\s*,\s*["']?(.*?)["']?(?:,|$)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const cama = m[1];
    const servicio = (m[8] || '').trim().toUpperCase();
    let floor = '';

    if (servicio.includes('TAMO')) {
      floor = 'tamo';
    } else if (servicio.includes('U.T.I.Q') || servicio.includes('UTIQ') || servicio.includes('PISO 2')) {
      floor = 'utiq';
    } else if (servicio.includes('U.T.I') || servicio.includes('UTI') || servicio.includes('PISO 4')) {
      floor = 'uti';
    } else {
      const firstChar = cama.charAt(0);
      if (['3', '4', '5'].includes(firstChar)) {
        floor = firstChar;
      } else {
        floor = '3';
      }
    }

    patients.push({
      cama: cama,
      hc: m[3].replace('.0', ''),
      paciente: m[2].trim(),
      medico: m[4].trim(),
      ingreso: m[5],
      dias: m[6],
      cobertura: (m[7] || '').trim(),
      servicio: servicio,
      diagnostico: (m[9] || '').trim() || 'SIN DIAGNÓSTICO',
      floor: floor,
    });
  }
  return patients;
}

function showCSVPreview(patients) {
  const el = document.getElementById('csv-preview');
  if (!patients.length) {
    el.style.display = 'none';
    showToast('No se encontraron pacientes');
    return;
  }
  el.style.display = 'flex';
  el.innerHTML = `
    <div class="preview-info">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <span>${patients.length} pacientes encontrados en ${new Set(patients.map(p => p.floor)).size} pisos</span>
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
  for (const p of pendingCSV) {
    allPatients[p.hc] = p;
  }
  localStorage.setItem('sc_patients', JSON.stringify(allPatients));
  if (db) {
    for (const [hc, p] of Object.entries(allPatients)) {
      try {
        setDoc(doc(db, 'patients', hc), p).catch(() => { });
      } catch (e) { }
    }
  }
  closeCSV();
  renderTable();
  renderFloorTabs();
  showToast(`${pendingCSV.length} pacientes importados ✓`);
  pendingCSV = [];
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

// ─── HISTORY VIEW ─────────────────────────────────────────────────────────────
function toggleView(view) {
  document.getElementById('view-main').style.display = view === 'main' ? 'block' : 'none';
  document.getElementById('view-history').style.display = view === 'history' ? 'block' : 'none';
  if (view === 'history') searchHistory();
}

function searchHistory() {
  const patQ = document.getElementById('hist-search-patient').value.toLowerCase().trim();
  const drugQ = document.getElementById('hist-search-drug').value.toLowerCase().trim();
  const weekQ = document.getElementById('hist-search-week').value;
  const weeks = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key.startsWith('sc_week_')) continue;
    const wid = key.replace('sc_week_', '');
    if (weekQ && wid !== weekQ) continue;
    try { weeks[wid] = JSON.parse(localStorage.getItem(key)); } catch (e) { }
  }
  const results = [];
  for (const [wid, data] of Object.entries(weeks)) {
    for (const [key, dayData] of Object.entries(data)) {
      const parts = key.split('_');
      const hc = parts[0];
      const day = parts[1];
      if (!day || !DAYS.includes(day)) continue;
      const patient = allPatients[hc];
      if (!patient) continue;
      if (patQ && !patient.paciente.toLowerCase().includes(patQ)) continue;
      let drugMatch = !drugQ;
      if (drugQ) {
        for (const cat of CATS) {
          const cd = dayData[cat.id];
          if (!cd) continue;
          if ((cd.text || '').toLowerCase().includes(drugQ)) { drugMatch = true; break; }
          if ((cd.tags || []).some(t => t.toLowerCase().includes(drugQ))) { drugMatch = true; break; }
        }
      }
      if (!drugMatch) continue;
      results.push({ wid, day, patient, hc, dayData });
    }
  }
  renderHistoryResults(results);
}

function renderHistoryResults(results) {
  const el = document.getElementById('history-results');
  if (!results.length) {
    el.innerHTML = '<div class="no-data"><p>Sin resultados para los filtros aplicados.</p></div>';
    return;
  }
  const grouped = {};
  for (const r of results) {
    const gkey = `${r.wid}_${r.hc}`;
    if (!grouped[gkey]) grouped[gkey] = { wid: r.wid, patient: r.patient, hc: r.hc, days: {} };
    grouped[gkey].days[r.day] = r.dayData;
  }
  el.innerHTML = Object.values(grouped).map(g => `
    <div class="hist-card">
      <div class="hist-card-header">
        <span class="cell-room" style="font-size:12px;min-width:35px">${g.patient.cama}</span>
        <strong style="flex:1;font-size:13px">${g.patient.paciente}</strong>
        <span style="font-family:var(--mono);font-size:11px;color:var(--text3)">${g.wid} · ${getWeekDates(g.wid)}</span>
        <span style="margin-left:8px;color:var(--text3)">▾</span>
      </div>
      <div class="hist-card-body">
        ${DAYS.filter(d => g.days[d]).map(d => `
          <div>
            <span class="hist-day-label">${DAY_LABELS[d]}:</span>
            ${CATS.filter(c => { const e = g.days[d][c.id]; return e && (e.tags?.length || e.text); }).map(c => {
      const e = g.days[d][c.id];
      const parts = [];
      if (e.tags?.length) parts.push(e.tags.map(t => `<span class="badge ${c.cls}">${t}</span>`).join(' '));
      if (e.text) parts.push(`<span style="color:var(--text2);font-size:11px">${e.text}</span>`);
      return `<span style="margin-right:10px"><span style="color:${c.dot};font-size:11px;font-weight:600">${c.label}:</span> ${parts.join(' ')}</span>`;
    }).join('')}
          </div>`).join('')}
      </div>
    </div>`).join('');

  document.querySelectorAll('.hist-card-header').forEach(header => {
    header.addEventListener('click', function () {
      this.nextElementSibling.classList.toggle('open');
    });
  });
}

// ─── ADD PATIENT MODAL ────────────────────────────────────────────────────────
function openAddPatientModal() {
  if (!requireAuth()) return;
  document.getElementById('add-patient-overlay').classList.add('open');
}

function closeAddPatientModal() {
  document.getElementById('add-patient-overlay').classList.remove('open');
  document.getElementById('add-patient-form').reset();
}

function detectFloor(cama, servicio = '') {
  const s = String(cama);
  const servUpper = String(servicio).toUpperCase();

  if (servUpper.includes('TAMO')) return 'tamo';
  if (servUpper.includes('U.T.I.Q') || servUpper.includes('UTIQ')) return 'utiq';
  if (servUpper.includes('U.T.I') || servUpper.includes('UTI')) return 'uti';

  const numericFloors = ['3', '4', '5'];
  for (const f of numericFloors) {
    if (s.startsWith(f) && s.length === 3) return f;
  }
  for (const f of ['tamo', 'uti', 'utiq']) {
    if (s.toLowerCase().startsWith(f)) return f;
  }
  return s.charAt(0);
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

  const camaOcupada = Object.values(allPatients).find(p => p.cama === cama);
  if (camaOcupada) {
    showToast(`La cama ${cama} ya está ocupada por ${camaOcupada.paciente}`);
    return;
  }

  const floor = detectFloor(cama, servicio);
  const newPatient = {
    cama, hc, paciente, medico: medico || '—', cobertura: cobertura || '—',
    ingreso: ingreso || '—', dias: dias || '0', servicio: servicio || '—',
    diagnostico: diagnostico || 'SIN DIAGNÓSTICO', floor,
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
  const currentWeekEntries = {};
  for (const day of DAYS) {
    const key = `${hc}_${day}`;
    if (weekData[key]) currentWeekEntries[key] = weekData[key];
  }
  const dischargeRecord = {
    ...p, hc: String(hc), dischargeAt: new Date().toISOString(),
    dischargeWeek: currentWeek, weekEntries: currentWeekEntries,
  };
  const discharges = JSON.parse(localStorage.getItem('sc_discharges') || '[]');
  discharges.unshift(dischargeRecord);
  localStorage.setItem('sc_discharges', JSON.stringify(discharges));
  delete allPatients[hc];
  localStorage.setItem('sc_patients', JSON.stringify(allPatients));
  for (const day of DAYS) delete weekData[`${hc}_${day}`];
  localStorage.setItem(`sc_week_${currentWeek}`, JSON.stringify(weekData));

  saveAudit('delete', hc, null, { action: 'discharge', patientName: p.paciente, cama: p.cama });

  if (db) {
    try {
      await setDoc(doc(db, 'discharges', `${hc}_${Date.now()}`), dischargeRecord);
      await deleteDoc(doc(db, 'patients', String(hc)));
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
  const rooms = Object.values(allPatients)
    .filter(pat => {
      if (pat.hc === movePatientHc) return false;
      if (moveFilterFloor !== 'all') {
        const numericFloors = ['3', '4', '5'];
        if (numericFloors.includes(moveFilterFloor)) {
          if (!String(pat.cama).startsWith(moveFilterFloor)) return false;
        } else {
          if ((pat.floor || '').toLowerCase() !== moveFilterFloor) return false;
        }
      }
      if (search && !String(pat.cama).includes(search) && !pat.paciente.toLowerCase().includes(search)) return false;
      return true;
    })
    .sort((a, b) => String(a.cama).localeCompare(String(b.cama)));
  if (!rooms.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text3);font-size:12px;">Sin camas en este sector</div>`;
    return;
  }
  grid.innerHTML = rooms.map(pat => {
    const isSelected = moveSelectedRoom === pat.cama;
    return `
      <div class="bed-card occupied ${isSelected ? 'selected' : ''}" data-room="${pat.cama}">
        <div class="bed-card-room">${pat.cama}</div>
        <div class="bed-card-name">${pat.paciente.split(',')[0]}</div>
        <div class="bed-card-status busy">● Ocupada</div>
      </div>`;
  }).join('');

  document.querySelectorAll('.bed-card').forEach(card => {
    const room = card.dataset.room;
    card.addEventListener('click', () => selectMoveRoom(room, card));
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
  const existingPatient = Object.values(allPatients).find(pat => pat.cama === newRoom && String(pat.hc) !== String(movePatientHc));
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
  if (window.innerWidth <= 640 && document.getElementById('patient-days-overlay').classList.contains('open')) {
    renderPatientDaysList();
  } else {
    renderDaysRowContent(hc);
  }
  showToast(`${copied} día${copied !== 1 ? 's' : ''} copiados de la semana anterior ✓`);
}

// ─── SAVE WEEK ────────────────────────────────────────────────────────────────
async function saveWeek() {
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
  updateUserUI();

  if (Object.keys(allPatients).length > 0) {
    document.getElementById('config-banner').classList.add('hidden');
    renderTable();
  }

  const saved = localStorage.getItem('sc_fb_config');
  if (saved) {
    try {
      const cfg = JSON.parse(saved);
      await initFirebase(cfg);
      return;
    } catch (e) { }
  }

  if (Object.keys(allPatients).length > 0) {
    localMode = true;
  } else {
    renderAll();
  }
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────────────────
document.getElementById('prev-week').addEventListener('click', () => changeWeek(-1));
document.getElementById('next-week').addEventListener('click', () => changeWeek(1));
document.getElementById('btn-csv').addEventListener('click', () => openCSV());
document.getElementById('btn-history').addEventListener('click', () => toggleView('history'));
document.getElementById('btn-back-main').addEventListener('click', () => toggleView('main'));
document.getElementById('btn-save-week').addEventListener('click', () => saveWeek());
document.getElementById('btn-add-patient').addEventListener('click', () => openAddPatientModal());
document.getElementById('btn-save-config').addEventListener('click', () => saveConfig());
document.getElementById('btn-local-mode').addEventListener('click', () => useLocalMode());
document.getElementById('btn-login').addEventListener('click', () => doLogin());
document.getElementById('btn-cancel-login').addEventListener('click', () => closeLoginModal());
document.getElementById('btn-logout').addEventListener('click', () => logout());

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

// History filters
document.getElementById('hist-search-patient').addEventListener('input', () => searchHistory());
document.getElementById('hist-search-drug').addEventListener('input', () => searchHistory());
document.getElementById('hist-search-week').addEventListener('input', () => searchHistory());

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