// Importar configuración de Firebase desde archivo separado
// Esto permite gestionar las credenciales de forma más organizada y segura

const firebaseConfig = window.FIREBASE_CONFIG || {};

function resolveFirebaseConfig(rawConfig) {
    const placeholderPattern = /^__.+__$/;
    const hasPlaceholders = rawConfig && Object.values(rawConfig).some(v => typeof v === 'string' && placeholderPattern.test(v));

    if (!hasPlaceholders && rawConfig) return rawConfig;

    const fromWindow = window.FIREBASE_CONFIG;
    if (fromWindow && typeof fromWindow === 'object') return fromWindow;

    try {
        const stored = localStorage.getItem('firebaseConfig');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch (_) {}

    return rawConfig;
}

function isFirebaseConfigComplete(config) {
    if (!config || typeof config !== 'object') return false;
    const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'appId'];
    const placeholderPattern = /^__.+__$/;
    return requiredKeys.every((key) => {
        const value = config[key];
        return typeof value === 'string' && value.trim() && !placeholderPattern.test(value.trim());
    });
}

const resolvedFirebaseConfig = resolveFirebaseConfig(firebaseConfig);
firebase.initializeApp(resolvedFirebaseConfig);
let auth = null;
const db = firebase.firestore();

function getAuth() {
    if (!auth) auth = firebase.auth();
    return auth;
}

let ABX = {};
let ESTAB = [];
let estabTipoFilter = '';
let currentUser = null;
let editingName = null;
let editingEstabId = null;
let selName = null;
let activeFam = null;

// ── HELPERS ─────────────────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function renderAjusteRenal(d) {
    const renderMarkdownTableFromText = (inputText) => {
        if (!inputText) return null;
        const normalizedRaw = inputText.replace(/\r/g, '');
        const lines = normalizedRaw.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) return null;

        const isSeparatorLine = (line) => {
            const clean = line.trim();
            if (!clean.includes('|')) return false;
            const withoutAllowed = clean.replace(/[|:\-\s–—]/g, '');
            const dashCount = (clean.match(/[-–—]/g) || []).length;
            return withoutAllowed.length === 0 && dashCount >= 3;
        };
        const parseRow = (line) => line
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map(cell => cell.trim());

        let tableStart = -1;
        let tableEnd = -1;
        for (let i = 0; i < lines.length - 2; i++) {
            const header = lines[i];
            const separator = lines[i + 1];
            if (!header.includes('|') || !isSeparatorLine(separator)) continue;
            tableStart = i;
            tableEnd = i + 2;
            while (tableEnd < lines.length && lines[tableEnd].includes('|')) tableEnd++;
            break;
        }

        if (tableStart < 0) return null;

        const tableLines = lines.slice(tableStart, tableEnd);
        const headers = parseRow(tableLines[0]);
        const bodyRows = tableLines.slice(2).map(parseRow).filter(r => r.length);
        if (!headers.length || !bodyRows.length) return null;

        let html = '<div class="renal-table"><table><thead><tr>';
        html += headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
        html += '</tr></thead><tbody>';
        bodyRows.forEach(row => {
            const normalized = headers.map((_, idx) => row[idx] || '—');
            html += '<tr>' + normalized.map(cell => `<td>${escapeHtml(cell)}</td>`).join('') + '</tr>';
        });
        html += '</tbody></table></div>';

        const beforeText = lines.slice(0, tableStart);
        const afterText = lines.slice(tableEnd);
        const extraText = [...beforeText, ...afterText];
        if (extraText.length) {
            html += `<div class="body-txt" style="margin-top:10px;">${escapeHtml(extraText.join('\n'))}</div>`;
        }
        return html;
    };

    // 1. Si existe la tabla estructurada, la usamos
    if (d.ajuste_renal_table && typeof d.ajuste_renal_table === 'object') {
        const table = d.ajuste_renal_table;
        const headers = table.headers || [];
        const rows = table.rows || [];
        if (headers.length && rows.length) {
            let html = '<div class="renal-table table-wrapper"><table class="farma-table">';
            html += '<thead><tr>' + headers.map(h => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead>';
            html += '<tbody>';
            for (const row of rows) {
                html += '<tr>' + row.map(cell => `<td>${escapeHtml(cell || '—')}</td>`).join('') + '</tr>';
            }
            html += '</tbody></table></div>';
            return html;
        }
    }
    // 2. Intentar parsear markdown table desde ajuste_renal_raw (o campos legacy)
    if (d.ajuste_renal_raw) {
        const raw = d.ajuste_renal_raw;
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        const tableLines = lines.filter(line => line.includes('|'));
        const separatorRegex = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;
        const separatorIdx = tableLines.findIndex(line => separatorRegex.test(line));

        if (tableLines.length >= 3 && separatorIdx === 1) {
            const parseRow = (line) => line
                .replace(/^\|/, '')
                .replace(/\|$/, '')
                .split('|')
                .map(cell => cell.trim());
            const headers = parseRow(tableLines[0]);
            const bodyRows = tableLines.slice(2).map(parseRow).filter(r => r.length);
            if (headers.length && bodyRows.length) {
                let html = '<div class="renal-table"><table><thead><tr>';
                html += headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
                html += '</tr></thead><tbody>';
                bodyRows.forEach(row => {
                    html += '<tr>' + row.map(cell => `<td>${escapeHtml(cell || '—')}</td>`).join('') + '</tr>';
                });
                html += '</tbody></table></div>';
                const nonTableLines = lines.filter(line => !tableLines.includes(line));
                if (nonTableLines.length) {
                    html += `<div class="body-txt" style="margin-top:10px;">${escapeHtml(nonTableLines.join('\n'))}</div>`;
                }
                return html;
            }
        }
        return `<pre class="pre-renal">${escapeHtml(raw)}</pre>`;
    }
    // 3. Intentar parsear markdown table desde ajuste_renal como último recurso
    if (d.ajuste_renal) {
        const raw = d.ajuste_renal;
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        const tableLines = lines.filter(line => line.includes('|'));
        const separatorRegex = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;
        const separatorIdx = tableLines.findIndex(line => separatorRegex.test(line));

        if (tableLines.length >= 3 && separatorIdx === 1) {
            const parseRow = (line) => line
                .replace(/^\|/, '')
                .replace(/\|$/, '')
                .split('|')
                .map(cell => cell.trim());
            const headers = parseRow(tableLines[0]);
            const bodyRows = tableLines.slice(2).map(parseRow).filter(r => r.length);
            if (headers.length && bodyRows.length) {
                let html = '<div class="renal-table"><table><thead><tr>';
                html += headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
                html += '</tr></thead><tbody>';
                bodyRows.forEach(row => {
                    html += '<tr>' + row.map(cell => `<td>${escapeHtml(cell || '—')}</td>`).join('') + '</tr>';
                });
                html += '</tbody></table></div>';
                const nonTableLines = lines.filter(line => !tableLines.includes(line));
                if (nonTableLines.length) {
                    html += `<div class="body-txt" style="margin-top:10px;">${escapeHtml(nonTableLines.join('\n'))}</div>`;
                }
                return html;
            }
        }
        // Si no tiene formato de tabla, mostrar como texto
        return `<div class="body-txt">${escapeHtml(raw)}</div>`;
    }
    return `<div class="body-txt">—</div>`;
}

function linkifyText(text) {
    const urlRegex = /(https?:\/\/[^\s<]+)/gi;
    return text.replace(urlRegex, (url) => {
        const safeUrl = escapeHtml(url);
        return `<a class="mono-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`;
    });
}

function renderMonografia(content) {
    if (!content || !content.toString().trim()) return '<div class="body-txt">—</div>';

    const normalized = content.toString().replace(/\r/g, '').trim();
    const lines = normalized.split('\n');

    const isSeparatorLine = (line) => {
        if (!line.includes('|')) return false;
        const clean = line.trim();
        const withoutAllowed = clean.replace(/[|:\-\s–—]/g, '');
        const dashCount = (clean.match(/[-–—]/g) || []).length;
        return withoutAllowed.length === 0 && dashCount >= 3;
    };

    const parseRow = (line) => line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(cell => cell.trim());

    const blocks = [];
    let textBuffer = [];
    const flushText = () => {
        if (!textBuffer.length) return;
        const txt = escapeHtml(textBuffer.join('\n'));
        blocks.push(`<div class="body-txt mono-text">${linkifyText(txt)}</div>`);
        textBuffer = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('|') && i + 1 < lines.length && isSeparatorLine(lines[i + 1])) {
            flushText();
            const tableLines = [line, lines[i + 1]];
            i += 2;
            while (i < lines.length && lines[i].includes('|')) {
                tableLines.push(lines[i]);
                i++;
            }
            i--;

            const headers = parseRow(tableLines[0]);
            const bodyRows = tableLines.slice(2).map(parseRow).filter(r => r.length);
            if (headers.length && bodyRows.length) {
                let tableHtml = '<div class="mono-table-wrap"><table class="mono-table"><thead><tr>';
                tableHtml += headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
                tableHtml += '</tr></thead><tbody>';
                for (const row of bodyRows) {
                    const normalizedRow = headers.map((_, idx) => row[idx] || '—');
                    tableHtml += '<tr>' + normalizedRow.map(cell => `<td>${linkifyText(escapeHtml(cell))}</td>`).join('') + '</tr>';
                }
                tableHtml += '</tbody></table></div>';
                blocks.push(tableHtml);
            }
        } else {
            textBuffer.push(line);
        }
    }
    flushText();

    return blocks.join('');
}

function getValue(d, keys, defaultValue = '—') {
    for (let key of keys) {
        if (d[key] && d[key].toString().trim()) return d[key];
    }
    return defaultValue;
}

// ── LOGIN ───────────────────────────────────────────────────────────────
async function doLogin() {
    const email = document.getElementById('usr').value.trim();
    const password = document.getElementById('pwd').value;
    const errBox = document.getElementById('lerr');
    if (!isFirebaseConfigComplete(resolvedFirebaseConfig)) {
        errBox.textContent = 'Configuración de Firebase incompleta. Definí window.FIREBASE_CONFIG o localStorage.firebaseConfig.';
        errBox.style.display = 'block';
        return;
    }
    const btn = document.querySelector('.lbtn');
    btn.innerText = 'Verificando...'; btn.disabled = true;
    try {
        const cred = await getAuth().signInWithEmailAndPassword(email, password);
        currentUser = cred.user;
        if (email === 'farmaceuticasiaf@gmail.com') {
            document.getElementById('adminBtn').style.display = '';
        }
    } catch (err) {
        const e = errBox;
        const msg = err && err.message ? err.message : 'No se pudo iniciar sesión';
        e.textContent = msg.includes('__FIREBASE_') || msg.includes('API key not valid') || msg.includes('CONFIGURATION_NOT_FOUND')
            ? 'Configuración de Firebase incompleta. Definí window.FIREBASE_CONFIG o localStorage.firebaseConfig.'
            : 'Usuario o contraseña incorrectos.';
        e.style.display = 'block';
        setTimeout(() => e.style.display = 'none', 5000);
    } finally {
        btn.innerText = 'Ingresar →'; btn.disabled = false;
    }
}
function doLogout() {
    if (!auth) return location.reload();
    auth.signOut().then(() => location.reload());
}

function showEditorsPopup() {
    alert(`Autores:
- Filippo Gisela
- Melin Virginia
- Rodríguez Florencia
- Santillán Mayra Nicole
- Toucedo Mailén

Agradecimientos:
- Giovanetti Franco
- Kot Lilian Jeanette

Revisión:
- Angulo Sergio`);
}
document.getElementById('pwd').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('usr').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('pwd').focus(); });

// ── PAGE SWITCHING ─────────────────────────────────────────────────────
function switchPage(pageId, btn, isMobile = false) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
    document.getElementById(pageId).classList.add('on');
    if (isMobile) {
        document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        document.querySelectorAll('.hnav-btn').forEach(b => b.classList.remove('on'));
        let topId = 'nav-abx';
        if (pageId === 'page-estab') topId = 'nav-estab';
        else if (pageId === 'page-calc') topId = 'nav-calc';
        const topBtn = document.getElementById(topId);
        if (topBtn) topBtn.classList.add('on');
    } else {
        document.querySelectorAll('.hnav-btn').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('on'));
        let botId = 'bnav-abx';
        if (pageId === 'page-estab') botId = 'bnav-estab';
        else if (pageId === 'page-calc') botId = 'bnav-calc';
        const botBtn = document.getElementById(botId);
        if (botBtn) botBtn.classList.add('on');
    }
    if (pageId === 'page-estab') renderEstabTable();
}

// ── FIRESTORE: ANTIBIÓTICOS ────────────────────────────────────────────
async function loadDataFromFirestore() {
    const snap = await db.collection('antibioticos').get();
    ABX = {};
    snap.forEach(doc => { ABX[doc.id] = doc.data(); });
}

// ── FIRESTORE: ESTABILIDADES ───────────────────────────────────────────
async function loadEstabilidades() {
    try {
        const snap = await db.collection('estabilidad').get();
        ESTAB = [];
        snap.forEach(doc => { ESTAB.push({ _id: doc.id, ...doc.data() }); });
        ESTAB.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        document.getElementById('estab-loading').style.display = 'none';
        buildEstabAdminSelect();
        renderEstabTable(); // Renderizar tabla para mostrar/ocultar botón Agregar
    } catch (err) {
        document.getElementById('estab-loading').innerText = 'Error al cargar estabilidades.';
    }
}

// ── ANTIBIÓTICOS: UI ───────────────────────────────────────────────────
function initApp() { buildFamFilters(); filterList(); }

function buildFamFilters() {
    const fams = new Set();
    for (const n in ABX) { if (ABX[n].familia) fams.add(ABX[n].familia); }
    const row = document.getElementById('fam-row');
    row.innerHTML = `<button class="fbtn ${!activeFam ? 'on' : ''}" onclick="filterFam(null)">Todas</button>`;
    Array.from(fams).sort().forEach(f => {
        row.innerHTML += `<button class="fbtn ${activeFam === f ? 'on' : ''}" onclick="filterFam('${f.replace(/'/g, "\\'")}')">${f}</button>`;
    });
}
function filterFam(fam) { 
    activeFam = fam; 
    buildFamFilters(); 
    if (selName) {
        clearSelection();
    } else {
        filterList(); 
    }
}

function clearSelection() {
    selName = null;
    filterList();
    document.getElementById('main').innerHTML = '<div class="empty"><div class="empty-ico">💊</div><div class="empty-txt">Seleccioná un antibiótico para ver su ficha</div><div class="empty-hint">Usá el buscador o filtrá por familia</div></div>';
}

function handleSearchInput() {
    if (selName) {
        clearSelection();
    } else {
        filterList();
    }
}

function filterList() {
    const q = document.getElementById('srch').value.toLowerCase();
    const list = document.getElementById('abx-list');
    const metaDiv = document.getElementById('list-meta');
    list.innerHTML = '';
    let count = 0;

    if (selName) {
        const d = ABX[selName];
        if (d && (activeFam ? d.familia === activeFam : true)) {
            count = 1;
            list.innerHTML = `<div class="abx-item sel" onclick="renderDetail('${selName.replace(/'/g, "\\'")}')"><div class="aname">${escapeHtml(selName)}</div><div class="atag">${escapeHtml(d.familia || '')}</div></div>`;
        }
        metaDiv.innerHTML = `<span>${count} antibiótico</span><button class="clear-btn" onclick="clearSelection()">✖ Limpiar</button>`;
        return;
    }

    Object.keys(ABX).sort().forEach(name => {
        const d = ABX[name];
        const searchableText = [
            name, d.familia,
            getValue(d, ['dosificacion', 'dosis']),
            getValue(d, ['mecanismo_accion', 'mecanismo']),
            d.administracion, d.ajuste_renal, d.ajuste_obesos,
            d.embarazo, d.lactancia, d.observaciones, d.interacciones,
            d.farmacocinetica, d.contenido_completo
        ].filter(Boolean).join(' ').toLowerCase();

        if (searchableText.includes(q) && (activeFam ? d.familia === activeFam : true)) {
            count++;
            list.innerHTML += `<div class="abx-item" onclick="renderDetail('${name.replace(/'/g, "\\'")}')"><div class="aname">${escapeHtml(name)}</div><div class="atag">${escapeHtml(d.familia || '')}</div></div>`;
        }
    });
    metaDiv.innerHTML = `<span>${count} antibiótico${count !== 1 ? 's' : ''}</span>`;
}

function renderDetail(name) {
    const d = ABX[name];
    if (!d) return;
    selName = name;

    const mecanismo = getValue(d, ['mecanismo_accion', 'mecanismo']);
    const dosificacion = getValue(d, ['dosificacion', 'dosis']);
    const administracion = getValue(d, ['administracion']);
    const preparacion = getValue(d, ['preparacion']);
    const ajuste_hepatico = getValue(d, ['ajuste_hepatico']);
    const ajuste_obesos = getValue(d, ['ajuste_obesos']);
    const embarazo = getValue(d, ['embarazo']);
    const lactancia = getValue(d, ['lactancia']);
    const observaciones = getValue(d, ['observaciones']);
    const interacciones = getValue(d, ['interacciones']);
    const farmacocinetica = getValue(d, ['farmacocinetica']);
    const contenido_completo = getValue(d, ['contenido_completo']);
    
    document.getElementById('main').innerHTML = `
        <div class="detail">
            <div class="d-hdr">
                <div class="d-fam">${escapeHtml(d.familia || 'Sin familia')}</div>
                <h2 class="d-name">${escapeHtml(name)}</h2>
            </div>
            <div class="detail-tabs">
                <button class="dtab on" onclick="switchDTab(event,'dt-general')">💊 General</button>
                <button class="dtab" onclick="switchDTab(event,'dt-ajustes')">⚖️ Ajustes</button>
                <button class="dtab" onclick="switchDTab(event,'dt-seguridad')">⚠️ Seguridad</button>
                <button class="dtab" onclick="switchDTab(event,'dt-pk')">📈 Farmacocinética</button>
                <button class="dtab" onclick="switchDTab(event,'dt-monografia')">📄 Monografía</button>
            </div>

            <!-- General -->
            <div class="dtab-panel on" id="dt-general">
                <div class="cards-grid two-col">
                    <div class="card"><div class="card-ttl">Mecanismo de acción</div><div class="body-txt">${escapeHtml(mecanismo)}</div></div>
                    <div class="card"><div class="card-ttl">Dosificación</div><div class="body-txt">${escapeHtml(dosificacion)}</div></div>
                    <div class="card"><div class="card-ttl">Administración</div><div class="body-txt">${escapeHtml(administracion)}</div></div>
                    <div class="card"><div class="card-ttl">Preparación / Reconstitución</div><div class="body-txt">${escapeHtml(preparacion)}</div></div>
                </div>
            </div>

            <!-- Ajustes -->
            <div class="dtab-panel" id="dt-ajustes">
                <div class="cards-grid two-col">
                    <div class="card card-full"><div class="card-ttl">Ajuste Renal</div>${renderAjusteRenal(d)}<div class="renal-scroll-hint">← deslizá para ver más →</div></div>
                    <div class="card"><div class="card-ttl">Ajuste Hepático</div><div class="body-txt">${escapeHtml(ajuste_hepatico)}</div></div>
                    <div class="card"><div class="card-ttl">Ajuste en Obesos</div><div class="body-txt">${escapeHtml(ajuste_obesos)}</div></div>
                </div>
            </div>

            <!-- Seguridad -->
            <div class="dtab-panel" id="dt-seguridad">
                <div class="cards-grid two-col">
                    <div class="card"><div class="card-ttl">Embarazo</div><div class="body-txt">${escapeHtml(embarazo)}</div></div>
                    <div class="card"><div class="card-ttl">Lactancia</div><div class="body-txt">${escapeHtml(lactancia)}</div></div>
                    <div class="card"><div class="card-ttl">Observaciones</div><div class="body-txt">${escapeHtml(observaciones)}</div></div>
                    <div class="card"><div class="card-ttl">Interacciones</div><div class="body-txt">${escapeHtml(interacciones)}</div></div>
                </div>
            </div>

            <!-- Farmacocinética -->
            <div class="dtab-panel" id="dt-pk">
                <div class="card"><div class="card-ttl">Farmacocinética</div><div class="body-txt">${escapeHtml(farmacocinetica)}</div></div>
            </div>

            <!-- Monografía -->
            <div class="dtab-panel" id="dt-monografia">
                <div class="card">
                    <div class="card-ttl">Contenido Completo</div>
                    ${renderMonografia(contenido_completo)}
                </div>
            </div>
        </div>`;
    filterList();
}

function switchDTab(e, id) {
    const detail = e.target.closest('.detail');
    detail.querySelectorAll('.dtab').forEach(t => t.classList.remove('on'));
    detail.querySelectorAll('.dtab-panel').forEach(p => p.classList.remove('on'));
    e.target.classList.add('on');
    document.getElementById(id).classList.add('on');
    document.getElementById('main').scrollTo({ top: 0, behavior: 'smooth' });
}

// ── HERRAMIENTAS DE CÁLCULO ─────────────────────────────────────────────
function buildToolsHTML() {
  return `<div class="tools-section">
    <div class="tools-tabs">
      <button class="ttab on" onclick="switchTab(event,'tab-crcl')">🧪 CrCl Renal</button>
      <button class="ttab" onclick="switchTab(event,'tab-dosis')">⚖️ Dosis Obesos</button>
      <button class="ttab" onclick="switchTab(event,'tab-pk')">📈 T&gt;CMI</button>
      <button class="ttab" onclick="switchTab(event,'tab-cp')">💉 Pico/Valle</button>
    </div>
    <div class="tool-panel on" id="tab-crcl"><div class="tool-card"><h3>Filtrado Glomerular Estimado (MDRD)</h3><p>Primero estimá eGFR con MDRD (mL/min/1.73 m²). Útil para estadificar ERC.</p><div class="tool-grid"><div class="tf"><label>Edad (años)</label><input id="mdrd-edad" type="number" placeholder="65"></div><div class="tf"><label>Sexo</label><select id="mdrd-sexo"><option value="M">Masculino</option><option value="F">Femenino</option></select></div><div class="tf"><label>Raza</label><select id="mdrd-raza"><option value="no-negro">No negro</option><option value="negro">Negro</option></select></div><div class="tf"><label>Creatinina (mg/dL)</label><input id="mdrd-cr" type="number" step="0.1" placeholder="1.0"></div></div><button class="calc-btn" onclick="calcMDRD()">Calcular MDRD →</button><div class="result-box" id="res-mdrd"></div></div><div class="tool-card" style="margin-top:14px;"><h3>Aclaramiento de Creatinina (Cockcroft-Gault)</h3><p>Luego estimá CrCl para ajuste de dosis. Usa peso ajustado en obesos automáticamente.</p><div class="tool-grid"><div class="tf"><label>Edad (años)</label><input id="cg-edad" type="number" placeholder="65"></div><div class="tf"><label>Peso real (kg)</label><input id="cg-peso" type="number" placeholder="70"></div><div class="tf"><label>Altura <span style="font-weight:400;text-transform:none;color:var(--g3);">(opcional, cm o m)</span></label><input id="cg-talla" type="number" step="0.01" placeholder="170 o 1.70"></div><div class="tf"><label>Sexo</label><select id="cg-sexo"><option value="M">Masculino</option><option value="F">Femenino</option></select></div><div class="tf"><label>Creatinina (mg/dL)</label><input id="cg-cr" type="number" step="0.1" placeholder="1.0"></div></div><button class="calc-btn" onclick="calcCrCl()">Calcular CrCl →</button><div class="result-box" id="res-crcl"></div></div></div>
    <div class="tool-panel" id="tab-dosis"><div class="tool-card"><h3>Peso de Dosificación en Obesidad</h3><p>Calcula IBW (Devine), ABW (factor 0.4) e IMC para orientar la dosificación.</p><div class="tool-grid"><div class="tf"><label>Peso real (kg)</label><input id="ob-peso" type="number" placeholder="110"></div><div class="tf"><label>Talla (cm)</label><input id="ob-talla" type="number" placeholder="170"></div><div class="tf"><label>Sexo</label><select id="ob-sexo"><option value="M">Masculino</option><option value="F">Femenino</option></select></div></div><button class="calc-btn" onclick="calcObesos()">Calcular →</button><div class="result-box" id="res-obesos"></div></div></div>
    <div class="tool-panel" id="tab-pk"><div class="tool-card"><h3>T&gt;CMI — Antibióticos Tiempo-Dependientes</h3><p>Estima % del intervalo con concentración libre sobre la CMI. Meta ≥ 40–50% (beta-lactámicos).</p><div class="tool-grid"><div class="tf"><label>Dosis (mg)</label><input id="pk-dosis" type="number" placeholder="1000"></div><div class="tf"><label>Intervalo (hs)</label><input id="pk-intervalo" type="number" placeholder="8"></div><div class="tf"><label>Vd (L/kg)</label><input id="pk-vd" type="number" step="0.01" placeholder="0.2"></div><div class="tf"><label>Peso (kg)</label><input id="pk-peso" type="number" placeholder="70"></div><div class="tf"><label>t½ (hs)</label><input id="pk-t12" type="number" step="0.1" placeholder="1.5"></div><div class="tf"><label>CMI (mg/L)</label><input id="pk-cmi" type="number" step="0.001" placeholder="2"></div><div class="tf"><label>Fracción libre (fu)</label><input id="pk-fu" type="number" step="0.01" placeholder="0.9"></div></div><button class="calc-btn" onclick="calcPKPD()">Calcular T&gt;CMI →</button><div class="result-box" id="res-pkpd"></div></div></div>
    <div class="tool-panel" id="tab-cp"><div class="tool-card"><h3>Concentración Pico y Valle (1 compartimento)</h3><p>Cmax y Ctrough al estado estacionario. Útil para aminoglucósidos y vancomicina.</p><div class="tool-grid"><div class="tf"><label>Dosis (mg)</label><input id="cp-dosis" type="number" placeholder="500"></div><div class="tf"><label>Intervalo τ (hs)</label><input id="cp-tau" type="number" placeholder="8"></div><div class="tf"><label>Vd (L/kg)</label><input id="cp-vd" type="number" step="0.01" placeholder="0.25"></div><div class="tf"><label>Peso (kg)</label><input id="cp-peso" type="number" placeholder="70"></div><div class="tf"><label>t½ (hs)</label><input id="cp-t12" type="number" step="0.1" placeholder="2"></div><div class="tf"><label>Infusión (min)</label><input id="cp-tinf" type="number" placeholder="30"></div></div><button class="calc-btn" onclick="calcPicovalle()">Calcular →</button><div class="result-box" id="res-cp"></div></div></div>
  </div>`;
}

function switchTab(e, id) {
  const section = e.target.closest('.tools-section');
  section.querySelectorAll('.ttab').forEach(t => t.classList.remove('on'));
  section.querySelectorAll('.tool-panel').forEach(p => p.classList.remove('on'));
  e.target.classList.add('on');
  document.getElementById(id).classList.add('on');
}

function calcMDRD() {
  const edad = parseFloat(document.getElementById('mdrd-edad').value);
  const sexo = document.getElementById('mdrd-sexo').value;
  const raza = document.getElementById('mdrd-raza').value;
  const cr = parseFloat(document.getElementById('mdrd-cr').value);

  if ([edad, cr].some(isNaN)) return alert('Completá edad y creatinina');
  if (edad <= 0 || cr <= 0) return alert('Edad y creatinina deben ser mayores a 0');

  let egfr = 175 * (cr ** -1.154) * (edad ** -0.203);
  if (sexo === 'F') egfr *= 0.742;
  if (raza === 'negro') egfr *= 1.210;

  if (!Number.isFinite(egfr) || egfr <= 0) {
    return alert('No se pudo calcular MDRD. Verificá los valores ingresados.');
  }

  egfr = Math.round(egfr * 10) / 10;

  let cat = '', cls = '';
  if (egfr >= 90) { cat = 'G1 (≥90)'; cls = 'pill-green'; }
  else if (egfr >= 60) { cat = 'G2 (60–89)'; cls = 'pill-green'; }
  else if (egfr >= 45) { cat = 'G3a (45–59)'; cls = 'pill-amber'; }
  else if (egfr >= 30) { cat = 'G3b (30–44)'; cls = 'pill-amber'; }
  else if (egfr >= 15) { cat = 'G4 (15–29)'; cls = 'pill-red'; }
  else { cat = 'G5 (<15)'; cls = 'pill-red'; }

  const box = document.getElementById('res-mdrd');
  const razaTxt = raza === 'negro' ? ' (raza: negro)' : ' (raza: no negro)';
  box.innerHTML = `<div class="result-main">${egfr} mL/min/1.73 m²${razaTxt}</div><div class="result-sub">Estadio ERC: <span class="pill ${cls}">${cat}</span></div>${egfr < 60 ? '<div class="result-warn">⚠ eGFR &lt;60 — considerar ERC y correlacionar con albuminuria.</div>' : ''}`;
  box.classList.add('show');
}

function calcCrCl() {
  const edad = parseFloat(document.getElementById('cg-edad').value);
  const peso = parseFloat(document.getElementById('cg-peso').value);
  const tallaInputRaw = document.getElementById('cg-talla').value.trim();
  const sexo = document.getElementById('cg-sexo').value;
  const cr = parseFloat(document.getElementById('cg-cr').value);
  
  if ([edad, peso, cr].some(isNaN)) return alert('Completá edad, peso y creatinina');
  
  let pesoDos = peso;
  let ibw = null;
  let usaAjustado = false;
  
  // Si se proporciona la altura (opcional), calcular IBW y peso ajustado para obesos
  // Acepta cm (ej. 170) o metros (ej. 1.70)
  if (tallaInputRaw && !isNaN(parseFloat(tallaInputRaw))) {
    let tallaCm = parseFloat(tallaInputRaw);
    if (tallaCm > 0 && tallaCm <= 3) tallaCm *= 100;
    const tallaIn = tallaCm / 2.54;
    ibw = sexo === 'M' ? 50 + 2.3 * (tallaIn - 60) : 45.5 + 2.3 * (tallaIn - 60);
    ibw = Math.max(ibw, 45);
    
    if (peso > ibw * 1.2) {
      pesoDos = ibw + 0.4 * (peso - ibw);
      usaAjustado = true;
    }
  }
  
  let crcl = ((140 - edad) * pesoDos) / (72 * cr);
  if (sexo === 'F') crcl *= 0.85;
  crcl = Math.round(crcl * 10) / 10;
  
  let cat = '', cls = '';
  if (crcl >= 90) { cat = 'Normal (≥90)'; cls = 'pill-green'; }
  else if (crcl >= 60) { cat = 'Leve (60–89)'; cls = 'pill-green'; }
  else if (crcl >= 30) { cat = 'Moderado (30–59)'; cls = 'pill-amber'; }
  else if (crcl >= 15) { cat = 'Severo (15–29)'; cls = 'pill-red'; }
  else { cat = 'Falla renal (<15)'; cls = 'pill-red'; }
  
  const box = document.getElementById('res-crcl');
  let pesoInfo = `<br>Peso utilizado (CG): <strong>${Math.round(pesoDos*10)/10} kg</strong>`;
  if (ibw !== null) {
    pesoInfo += ` ${usaAjustado ? '(Peso Ajustado ABW)' : '(Peso Real)'}`;
    pesoInfo += `<br>Peso Ideal IBW: <strong>${Math.round(ibw*10)/10} kg</strong>`;
  } else {
    pesoInfo += ` (sin ajuste por obesidad - falta talla)`;
  }
  
  box.innerHTML = `<div class="result-main">${crcl} mL/min</div><div class="result-sub">Estadio: <span class="pill ${cls}">${cat}</span>${pesoInfo}</div>${crcl < 50 ? '<div class="result-warn">⚠ CrCl &lt;50 mL/min — revisar ajuste de dosis en la ficha.</div>' : ''}`;
  box.classList.add('show');
}

function calcObesos() {
  const peso = parseFloat(document.getElementById('ob-peso').value);
  const talla = parseFloat(document.getElementById('ob-talla').value);
  const sexo = document.getElementById('ob-sexo').value;
  if ([peso, talla].some(isNaN)) return alert('Completá todos los campos');
  const bmi = peso / ((talla/100) ** 2);
  const tallaIn = talla / 2.54;
  let ibw = sexo === 'M' ? 50 + 2.3 * (tallaIn - 60) : 45.5 + 2.3 * (tallaIn - 60);
  ibw = Math.max(ibw, 45);
  const abw = ibw + 0.4 * (peso - ibw);
  let cat = '', cls = '';
  if (bmi < 25) { cat = 'Normopeso'; cls = 'pill-green'; }
  else if (bmi < 30) { cat = 'Sobrepeso'; cls = 'pill-amber'; }
  else if (bmi < 35) { cat = 'Obesidad I'; cls = 'pill-red'; }
  else if (bmi < 40) { cat = 'Obesidad II'; cls = 'pill-red'; }
  else { cat = 'Obesidad mórbida'; cls = 'pill-red'; }
  const box = document.getElementById('res-obesos');
  box.innerHTML = `<div class="result-main">IMC: ${Math.round(bmi*10)/10} kg/m²</div><div class="result-sub"><span class="pill ${cls}">${cat}</span><br>IBW (Devine): <strong>${Math.round(ibw*10)/10} kg</strong><br>ABW (factor 0.4): <strong>${Math.round(abw*10)/10} kg</strong><br><br>Aminoglucósidos: IBW o ABW · Vancomicina (carga): TBW · Beta-lactámicos hidrofílicos: IBW · Lipofílicos (FQ, linezolid): TBW</div>${peso > ibw * 1.2 ? '<div class="result-warn">⚠ Paciente obeso — consultar ajuste específico en la ficha del antibiótico.</div>' : ''}`;
  box.classList.add('show');
}

function calcPKPD() {
  const dosis = parseFloat(document.getElementById('pk-dosis').value);
  const tau = parseFloat(document.getElementById('pk-intervalo').value);
  const vdKg = parseFloat(document.getElementById('pk-vd').value);
  const peso = parseFloat(document.getElementById('pk-peso').value);
  const t12 = parseFloat(document.getElementById('pk-t12').value);
  const cmi = parseFloat(document.getElementById('pk-cmi').value);
  const fu = parseFloat(document.getElementById('pk-fu').value) || 1;
  if ([dosis, tau, vdKg, peso, t12, cmi].some(isNaN)) return alert('Completá todos los campos');
  const vd = vdKg * peso;
  const ke = Math.log(2) / t12;
  const cmaxSS = (dosis / vd) / (1 - Math.exp(-ke * tau));
  const cminSS = cmaxSS * Math.exp(-ke * tau);
  let tSuperCMI = 0;
  if (cmaxSS * fu >= cmi) { tSuperCMI = Math.min(Math.log(cmaxSS * fu / cmi) / ke, tau); }
  const pct = Math.round((tSuperCMI / tau) * 1000) / 10;
  const m40 = pct >= 40, m50 = pct >= 50;
  const box = document.getElementById('res-pkpd');
  box.innerHTML = `<div class="result-main">T&gt;CMI: ${pct}%</div><div class="result-sub">Cmax ss: <strong>${Math.round(cmaxSS*100)/100} mg/L</strong> | Ctrough ss: <strong>${Math.round(cminSS*100)/100} mg/L</strong><br>Meta ≥40%: <span class="pill ${m40?'pill-green':'pill-red'}">${m40?'✓ Cumple':'✗ No cumple'}</span> Meta ≥50%: <span class="pill ${m50?'pill-green':'pill-amber'}">${m50?'✓ Cumple':'✗ No cumple'}</span></div>${!m40 ? '<div class="result-warn">⚠ T>CMI insuficiente — considerar aumentar dosis, reducir intervalo o infusión extendida.</div>' : ''}`;
  box.classList.add('show');
}

function calcPicovalle() {
  const dosis = parseFloat(document.getElementById('cp-dosis').value);
  const tau = parseFloat(document.getElementById('cp-tau').value);
  const vdKg = parseFloat(document.getElementById('cp-vd').value);
  const peso = parseFloat(document.getElementById('cp-peso').value);
  const t12 = parseFloat(document.getElementById('cp-t12').value);
  const tinfH = (parseFloat(document.getElementById('cp-tinf').value) || 30) / 60;
  if ([dosis, tau, vdKg, peso, t12].some(isNaN)) return alert('Completá todos los campos');
  const vd = vdKg * peso;
  const ke = Math.log(2) / t12;
  const k0 = dosis / tinfH;
  const accFactor = 1 / (1 - Math.exp(-ke * tau));
  const cmaxSS = (k0 / (vd * ke)) * (1 - Math.exp(-ke * tinfH)) * accFactor;
  const ctroughSS = cmaxSS * Math.exp(-ke * (tau - tinfH));
  const box = document.getElementById('res-cp');
  box.innerHTML = `<div class="result-main">Cmax: ${Math.round(cmaxSS*100)/100} mg/L</div><div class="result-sub">Concentración pico (Cmax): <strong>${Math.round(cmaxSS*100)/100} mg/L</strong><br>Concentración valle (Ctrough): <strong>${Math.round(ctroughSS*100)/100} mg/L</strong><br>Vd total: <strong>${Math.round(vd*10)/10} L</strong> | ke: <strong>${Math.round(ke*1000)/1000} h⁻¹</strong><br><em>Modelo 1-compartimento al estado estacionario.</em></div>`;
  box.classList.add('show');
}

// ── ESTABILIDADES TABLE (solo lectura) ─────────────────────────────────
function renderEstabTable() {
  // Ocultar/mostrar botón Agregar según si es admin
  const addBtn = document.getElementById('estabAddBtn');
  if (addBtn) {
    if (currentUser && currentUser.email === 'farmaceuticasiaf@gmail.com') {
      addBtn.style.display = '';
    } else {
      addBtn.style.display = 'none';
    }
  }

  const q = document.getElementById('estab-srch').value.toLowerCase();
  const tbody = document.getElementById('estab-tbody');
  const loading = document.getElementById('estab-loading');
  if (ESTAB.length === 0) {
    loading.style.display = 'flex';
    loading.innerText = 'Sin datos. Usá el botón "Agregar" para crear una estabilidad.';
    tbody.innerHTML = '';
    return;
  }
  loading.style.display = 'none';
  const filtered = ESTAB.filter(e => {
    const matchTipo = estabTipoFilter ? e.tipo === estabTipoFilter : true;
    const searchText = [e.nombre, e.tipo, ...(e.presentaciones || []).map(p => [p.presentacion, p.vehiculo_dilucion, p.estab_dil_amb, p.estab_dil_ref, p.tiempo_infusion, p.observaciones, p.fuente].join(' '))].filter(Boolean).join(' ').toLowerCase();
    return matchTipo && (!q || searchText.includes(q));
  });
  document.getElementById('estab-meta').innerText = `${filtered.length} fármaco${filtered.length !== 1 ? 's' : ''}`;
  tbody.innerHTML = filtered.map(e => {
    const p = (e.presentaciones && e.presentaciones[0]) || {};
    const hasMore = e.presentaciones && e.presentaciones.length > 1;
    const tipoCls = e.tipo === 'QMT' ? 'etpill-qmt' : 'etpill-noqmt';
    const tipoLabel = e.tipo === 'NO_QMT' ? 'No QMT' : 'QMT';
    const tdAmbT = p.estab_dil_amb || '—';
    const tdRefT = p.estab_dil_ref || '—';
    const tdInfT = p.tiempo_infusion || '—';
    return `<tr>
      <td><span class="drug-name-cell">${escapeHtml(e.nombre)}</span>${hasMore ? `<small style="margin-left:6px;color:var(--g3)">+${e.presentaciones.length-1}</small>` : ''}</td>
      <td><span class="etpill ${tipoCls}">${escapeHtml(tipoLabel)}</span></td>
      <td>${escapeHtml(p.presentacion || '—')}</td>
      <td style="max-width:180px;font-size:12px;">${escapeHtml(p.vehiculo_dilucion || '—')}</td>
      <td><span class="estab-time ${tdAmbT==='—'?'na':''}">${escapeHtml(tdAmbT)}</span></td>
      <td><span class="estab-time ${tdRefT==='—'?'na':''}">${escapeHtml(tdRefT)}</span></td>
      <td><span class="estab-time ${tdInfT==='—'?'na':''}">${escapeHtml(tdInfT)}</span></td>
      <td class="estab-obs-cell">${escapeHtml(p.observaciones || '—')}</td>
    </tr>`;
  }).join('');
}
function filterEstab() { renderEstabTable(); }
function filterEstabTipo(tipo, btn) {
  estabTipoFilter = tipo;
  document.querySelectorAll('.etfbtn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  renderEstabTable();
}

// ── CRUD ESTABILIDADES ─────────────────────────────────────────────────
function buildEstabAdminSelect() {
  const sel = document.getElementById('admin-estab-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Crear Nueva --</option>';
  ESTAB.sort((a,b) => (a.nombre || '').localeCompare(b.nombre || '')).forEach(e => {
    sel.innerHTML += `<option value="${e._id}">${escapeHtml(e.nombre)}</option>`;
  });
}
function openEstabAdmin(id = null) {
  // Solo admin puede agregar/editar estabilidades
  if (!currentUser || currentUser.email !== 'farmaceuticasiaf@gmail.com') {
    alert('Solo el administrador puede agregar o editar estabilidades.');
    return;
  }
  editingEstabId = id;
  buildEstabAdminSelect();
  if (id) document.getElementById('admin-estab-select').value = id;
  loadEstabAdminData(id || '');
  document.getElementById('estab-admin-panel').classList.add('open');
}
function closeEstabAdmin() {
  document.getElementById('estab-admin-panel').classList.remove('open');
  editingEstabId = null;
}
function loadEstabAdminData(id) {
  editingEstabId = id || null;
  const e = id ? ESTAB.find(x => x._id === id) : null;
  const p = (e?.presentaciones && e.presentaciones[0]) || {};
  document.getElementById('ea-name').value = e?.nombre || '';
  document.getElementById('ea-name').disabled = !!e;
  document.getElementById('ea-tipo').value = e?.tipo || 'QMT';
  document.getElementById('ea-presentacion').value = p.presentacion || '';
  document.getElementById('ea-vehiculo').value = p.vehiculo_dilucion || '';
  document.getElementById('ea-amb').value = p.estab_dil_amb || '';
  document.getElementById('ea-ref').value = p.estab_dil_ref || '';
  document.getElementById('ea-inf').value = p.tiempo_infusion || '';
  document.getElementById('ea-obs').value = p.observaciones || '';
  document.getElementById('ea-fuente').value = p.fuente || '';
  const delBtn = document.getElementById('delEstabBtn');
  if (delBtn) delBtn.style.display = e ? 'block' : 'none';
}
async function saveEstabilidad() {
  const nombre = document.getElementById('ea-name').value.trim();
  if (!nombre) return alert('Debés ingresar un nombre');
  const data = {
    nombre: nombre,
    tipo: document.getElementById('ea-tipo').value,
    presentaciones: [{
      presentacion: document.getElementById('ea-presentacion').value,
      vehiculo_dilucion: document.getElementById('ea-vehiculo').value,
      estab_dil_amb: document.getElementById('ea-amb').value,
      estab_dil_ref: document.getElementById('ea-ref').value,
      tiempo_infusion: document.getElementById('ea-inf').value,
      observaciones: document.getElementById('ea-obs').value,
      fuente: document.getElementById('ea-fuente').value
    }]
  };
  try {
    if (editingEstabId) await db.collection('estabilidad').doc(editingEstabId).set(data);
    else await db.collection('estabilidad').add(data);
    await loadEstabilidades();
    renderEstabTable();
    const notice = document.getElementById('admin-estab-notice');
    if (notice) { notice.style.display = 'block'; setTimeout(() => notice.style.display = 'none', 3000); }
    closeEstabAdmin();
  } catch (err) { alert('Error al guardar: ' + err.message); }
}
async function deleteEstabilidad() {
  const id = editingEstabId || document.getElementById('admin-estab-select').value;
  if (!id || !confirm(`¿Eliminar "${document.getElementById('ea-name').value}"?`)) return;
  try {
    await db.collection('estabilidad').doc(id).delete();
    await loadEstabilidades();
    renderEstabTable();
    loadEstabAdminData('');
    const delBtn = document.getElementById('delEstabBtn');
    if (delBtn) delBtn.style.display = 'none';
    if (editingEstabId === id) editingEstabId = null;
  } catch (err) { alert('Error: ' + err.message); }
}

// ── ADMIN ANTIBIÓTICOS (actualizado) ───────────────────────────────────
async function saveData() {
    const name = editingName || document.getElementById('af-name').value.trim();
    if (!name) return alert('Debes ingresar un nombre');

    const mecanismoValue = document.getElementById('af-mecanismo').value || '';
    const dosisValue = document.getElementById('af-dose').value || '';
    const ajusteRenalRaw = document.getElementById('af-renal-raw').value || '';

    const data = {
        familia: document.getElementById('af-fam').value || '',
        mecanismo_accion: mecanismoValue,
        mecanismo: mecanismoValue,
        dosificacion: dosisValue,
        dosis: dosisValue,
        administracion: document.getElementById('af-administracion').value || '',
        preparacion: document.getElementById('af-preparacion').value || '',
        ajuste_renal_raw: ajusteRenalRaw,
        ajuste_renal: ajusteRenalRaw,
        ajuste_hepatico: document.getElementById('af-hepatico').value || '',
        ajuste_obesos: document.getElementById('af-obesos').value || '',
        embarazo: document.getElementById('af-embarazo').value || '',
        lactancia: document.getElementById('af-lactancia').value || '',
        observaciones: document.getElementById('af-obs').value || '',
        interacciones: document.getElementById('af-inter').value || '',
        farmacocinetica: document.getElementById('af-pk').value || '',
        contenido_completo: document.getElementById('af-completo').value || ''
    };

    try {
        await db.collection('antibioticos').doc(name).set(data);
        ABX[name] = data;
        buildAdminSelect();
        document.getElementById('admin-select').value = name;
        buildFamFilters();
        filterList();
        editingName = name;
        if (selName === name) renderDetail(name);
        const n = document.getElementById('admin-notice');
        n.style.display = 'block';
        setTimeout(() => n.style.display = 'none', 3000);
        document.getElementById('delBtn').style.display = '';
    } catch (err) {
        alert('Error al guardar: ' + err.message);
    }
}

async function deleteAntibiotic() {
    const name = editingName || document.getElementById('admin-select').value;
    if (!name || !confirm(`¿Eliminar "${name}"?`)) return;
    try {
        await db.collection('antibioticos').doc(name).delete();
        delete ABX[name];
        buildAdminSelect();
        buildFamFilters();
        filterList();
        loadAdminData('');
        document.getElementById('delBtn').style.display = 'none';
        if (selName === name) {
            selName = null;
            document.getElementById('main').innerHTML = '<div class="empty"><div class="empty-ico">💊</div><div class="empty-txt">Seleccioná un antibiótico</div></div>';
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function openAdmin() {
    buildAdminSelect();
    loadAdminData('');
    document.getElementById('admin-panel').classList.add('open');
}
function closeAdmin() {
    document.getElementById('admin-panel').classList.remove('open');
    editingName = null;
}
function buildAdminSelect() {
    const sel = document.getElementById('admin-select');
    sel.innerHTML = '<option value="">-- Crear Nuevo --</option>';
    Object.keys(ABX).sort((a, b) => a.localeCompare(b)).forEach(n => {
        sel.innerHTML += `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`;
    });
}
function loadAdminData(name) {
    editingName = name || null;
    const d = name ? ABX[name] : {};

    document.getElementById('af-name').value = name || '';
    document.getElementById('af-name').disabled = !!name;
    document.getElementById('af-fam').value = d.familia || '';
    document.getElementById('af-mecanismo').value = getValue(d, ['mecanismo_accion', 'mecanismo'], '');
    document.getElementById('af-dose').value = getValue(d, ['dosificacion', 'dosis'], '');
    document.getElementById('af-administracion').value = d.administracion || '';
    document.getElementById('af-preparacion').value = d.preparacion || '';
    document.getElementById('af-renal-raw').value = d.ajuste_renal_raw || d.ajuste_renal || '';
    document.getElementById('af-hepatico').value = d.ajuste_hepatico || '';
    document.getElementById('af-obesos').value = d.ajuste_obesos || '';
    document.getElementById('af-embarazo').value = d.embarazo || '';
    document.getElementById('af-lactancia').value = d.lactancia || '';
    document.getElementById('af-obs').value = d.observaciones || '';
    document.getElementById('af-inter').value = d.interacciones || '';
    document.getElementById('af-pk').value = d.farmacocinetica || '';
    document.getElementById('af-completo').value = d.contenido_completo || '';

    document.getElementById('delBtn').style.display = name ? 'block' : 'none';
}
// ── CONTROL DE SESIÓN ──────────────────────────────────────────────────
getAuth().onAuthStateChanged(async (user) => {
    const loginScreen = document.getElementById('login');
    const appScreen = document.getElementById('app');
    if (user) {
        currentUser = user;
        loginScreen.style.display = 'none';

        const loadResults = await Promise.allSettled([loadDataFromFirestore(), loadEstabilidades()]);
        const hasDataError = loadResults.some(r => r.status === 'rejected');

        if (hasDataError) {
            console.error('[DATA] Error al cargar datos iniciales:', loadResults);
            const errBox = document.getElementById('lerr');
            if (errBox) {
                errBox.textContent = 'Sesión iniciada, pero hubo un error al cargar algunos datos. Recargá la página.';
                errBox.style.display = 'block';
            }
        }

        appScreen.style.display = 'flex';
        if (user.email === 'farmaceuticasiaf@gmail.com') document.getElementById('adminBtn').style.display = '';
        initApp();
    } else {
        appScreen.style.display = 'none';
        loginScreen.style.display = 'flex';
        const btn = document.querySelector('.lbtn');
        if (btn) { btn.innerText = 'Ingresar'; btn.disabled = false; }
    }
});
