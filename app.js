/* ===== Provisionsabrechnung PWA ===== */
'use strict';

let invoices = [];
let currentId = null;
let settings = { mwst: 19, firma: 'Heidi Keefer', adresse: '' };

const $ = id => document.getElementById(id);
const views = { list: $('viewList'), form: $('viewForm'), detail: $('viewDetail'), settings: $('viewSettings') };

// ─── Init ───
document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  await migrateFromIndexedDB();
  await loadInvoices();
  renderList();
  bindEvents();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
});

// ─── Supabase DB ───
const _db = AuthClient.supabase;

async function dbGetAll() {
  const { data, error } = await _db.from('invoices').select('data').order('datum', { ascending: false });
  if (error) { console.error(error); return []; }
  return (data || []).map(r => r.data);
}

async function dbPut(inv) {
  const session = await AuthClient.getSession();
  const { error } = await _db.from('invoices').upsert({
    id: inv.id,
    user_id: session.user.id,
    data: inv,
    datum: inv.datum || null
  });
  if (error) { toast('Fehler beim Speichern'); throw error; }
}

async function dbDelete(id) {
  const { error } = await _db.from('invoices').delete().eq('id', id);
  if (error) { toast('Fehler beim Löschen'); throw error; }
}

async function dbClear() {
  const { error } = await _db.from('invoices').delete().not('id', 'is', null);
  if (error) { toast('Fehler beim Löschen'); throw error; }
}

// ─── Migration: lokale IndexedDB → Supabase ───
async function migrateFromIndexedDB() {
  return new Promise(resolve => {
    const req = indexedDB.open('ProvisionenDB', 2);
    req.onupgradeneeded = () => {};
    req.onerror = () => resolve();
    req.onsuccess = async e => {
      const idb = e.target.result;
      if (!idb.objectStoreNames.contains('invoices')) { idb.close(); resolve(); return; }
      const all = idb.transaction('invoices', 'readonly').objectStore('invoices').getAll();
      all.onerror = () => { idb.close(); resolve(); };
      all.onsuccess = async () => {
        const local = all.result || [];
        if (local.length === 0) { idb.close(); resolve(); return; }

        const { data: existing } = await _db.from('invoices').select('id').limit(1);
        if (existing && existing.length > 0) { idb.close(); resolve(); return; }

        const session = await AuthClient.getSession();
        if (!session) { idb.close(); resolve(); return; }

        for (const inv of local) {
          await _db.from('invoices').upsert({
            id: inv.id, user_id: session.user.id, data: inv, datum: inv.datum || null
          });
        }
        idb.transaction('invoices', 'readwrite').objectStore('invoices').clear();
        idb.close();
        toast(`${local.length} lokale Rechnung${local.length !== 1 ? 'en' : ''} übertragen`);
        resolve();
      };
    };
  });
}

// ─── Settings ───
function loadSettings() {
  const s = localStorage.getItem('provSettings');
  if (s) try { Object.assign(settings, JSON.parse(s)); } catch(e) {}
  $('sMwst').value = settings.mwst;
  $('sFirma').value = settings.firma;
  $('sAdresse').value = settings.adresse;
}
function saveSettings() {
  settings.mwst = parseFloat($('sMwst').value) || 19;
  settings.firma = $('sFirma').value || 'Heidi Keefer';
  settings.adresse = $('sAdresse').value || '';
  localStorage.setItem('provSettings', JSON.stringify(settings));
  toast('Einstellungen gespeichert');
}

// ─── Data ───
async function loadInvoices() {
  invoices = await dbGetAll();
  invoices.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
}
function calcNetto(brutto) { return brutto / (1 + settings.mwst / 100); }
function calcProv(netto, pct) { return netto * (pct / 100); }

// ─── Helpers ───
function eur(v) { return (v || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }
function datumFormat(d) {
  if (!d) return '\u2014';
  const p = d.split('-');
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : d;
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ─── Navigation ───
function showView(name, title) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name].classList.add('active');
  $('headerTitle').textContent = title || 'Provisionen';
  $('btnBack').classList.toggle('hidden', name === 'list');
  $('btnSettings').classList.toggle('hidden', name !== 'list');
  window.scrollTo(0, 0);
}

// ─── Render List ───
function renderList() {
  const q = ($('searchInput').value || '').toLowerCase().trim();
  const filtered = q
    ? invoices.filter(inv => {
        const names = (inv.items || []).map(i => (i.name || '').toLowerCase()).join(' ');
        const arts = (inv.items || []).map(i => (i.art || '').toLowerCase()).join(' ');
        return names.includes(q) || arts.includes(q) || (inv.nummer || '').toLowerCase().includes(q);
      })
    : invoices;

  const list = $('invoiceList');
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">&#128196;</div>
      <p>${q ? 'Keine Ergebnisse' : 'Noch keine Rechnungen vorhanden'}</p>
    </div>`;
  } else {
    list.innerHTML = filtered.map(inv => {
      const total = (inv.items || []).reduce((s, i) => s + (i.provBetrag || 0), 0);
      const count = (inv.items || []).length;
      const names = (inv.items || []).map(i => i.name).filter(Boolean).join(', ');
      return `<div class="invoice-item" data-id="${inv.id}">
        <div class="inv-top">
          <span class="inv-nummer">${esc(inv.nummer || '\u2014')}</span>
          <span class="inv-betrag">${eur(total)}</span>
        </div>
        <div class="inv-middle">${esc(names || '\u2014')}</div>
        <div class="inv-bottom">
          <span class="inv-art">${count} Position${count !== 1 ? 'en' : ''}</span>
          <span>${datumFormat(inv.datum)}</span>
        </div>
      </div>`;
    }).join('');
  }

  const totalProv = filtered.reduce((s, inv) =>
    s + (inv.items || []).reduce((si, i) => si + (i.provBetrag || 0), 0), 0);
  $('summaryCount').textContent = `${filtered.length} Rechnung${filtered.length !== 1 ? 'en' : ''}`;
  $('summaryTotal').innerHTML = `Gesamt: ${eur(totalProv)}`;
}

// ─── Form: Item Management ───
let formItems = [];

function addItemRow(item) {
  item = item || { art: '', name: '', brutto: '', provision: '' };
  formItems.push(item);
  renderItems();
}

function removeItem(idx) {
  formItems.splice(idx, 1);
  renderItems();
}

function renderItems() {
  const container = $('itemsContainer');
  container.innerHTML = formItems.map((item, idx) => `
    <div class="item-card" data-idx="${idx}">
      <div class="item-header">
        <span class="item-label">Position ${idx + 1}</span>
        ${formItems.length > 1 ? `<button type="button" class="item-remove" data-idx="${idx}">&times;</button>` : ''}
      </div>
      <div class="form-group">
        <label>Art der Vermittlung</label>
        <select class="fi-art" data-idx="${idx}">
          <option value="">Bitte w\u00e4hlen...</option>
          <option ${item.art === 'Verkauf' ? 'selected' : ''}>Verkauf</option>
          <option ${item.art === 'Vermietung' ? 'selected' : ''}>Vermietung</option>
          <option ${item.art === 'Kauf' ? 'selected' : ''}>Kauf</option>
          <option ${item.art === 'Sonstiges' ? 'selected' : ''}>Sonstiges</option>
        </select>
      </div>
      <div class="form-group">
        <label>K\u00e4ufer/Verk\u00e4ufer/Mieter/Vermieter: Nachname</label>
        <input type="text" class="fi-name" data-idx="${idx}" value="${esc(item.name || '')}" placeholder="Nachname" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Rechnung (inkl. MwSt.) in \u20AC</label>
        <input type="number" class="fi-brutto" data-idx="${idx}" step="0.01" min="0" value="${item.brutto || ''}" placeholder="0,00" inputmode="decimal">
      </div>
      <div class="form-group computed">
        <label>Rechnung (ohne MwSt.)</label>
        <div class="fi-netto-display" data-idx="${idx}">${eur(item.brutto ? calcNetto(parseFloat(item.brutto)) : 0)}</div>
      </div>
      <div class="form-group">
        <label>Provision Keefer (in %)</label>
        <input type="number" class="fi-prov" data-idx="${idx}" step="0.1" min="0" max="100" value="${item.provision || ''}" placeholder="0,0" inputmode="decimal">
      </div>
      <div class="form-group computed">
        <label>Provisionsbetrag (in \u20AC)</label>
        <div class="fi-provbetrag-display" data-idx="${idx}">${eur(item.brutto && item.provision ? calcProv(calcNetto(parseFloat(item.brutto)), parseFloat(item.provision)) : 0)}</div>
      </div>
    </div>
  `).join('');
  updateTotals();
  bindItemEvents();
}

function bindItemEvents() {
  document.querySelectorAll('.item-remove').forEach(btn => {
    btn.onclick = () => {
      syncItemsFromDOM();
      removeItem(parseInt(btn.dataset.idx));
    };
  });
  document.querySelectorAll('.fi-art').forEach(el => {
    el.onchange = () => { formItems[el.dataset.idx].art = el.value; };
  });
  document.querySelectorAll('.fi-name').forEach(el => {
    el.oninput = () => { formItems[el.dataset.idx].name = el.value; };
  });
  document.querySelectorAll('.fi-brutto, .fi-prov').forEach(el => {
    el.oninput = () => {
      syncItemsFromDOM();
      updateCalculationsLive();
    };
  });
}

function syncItemsFromDOM() {
  document.querySelectorAll('.fi-art').forEach(el => { formItems[el.dataset.idx].art = el.value; });
  document.querySelectorAll('.fi-name').forEach(el => { formItems[el.dataset.idx].name = el.value; });
  document.querySelectorAll('.fi-brutto').forEach(el => { formItems[el.dataset.idx].brutto = el.value; });
  document.querySelectorAll('.fi-prov').forEach(el => { formItems[el.dataset.idx].provision = el.value; });
}

function updateCalculationsLive() {
  formItems.forEach((item, idx) => {
    const brutto = parseFloat(item.brutto) || 0;
    const prov = parseFloat(item.provision) || 0;
    const netto = calcNetto(brutto);
    const provBetrag = calcProv(netto, prov);
    const nettoEl = document.querySelector(`.fi-netto-display[data-idx="${idx}"]`);
    const provEl = document.querySelector(`.fi-provbetrag-display[data-idx="${idx}"]`);
    if (nettoEl) nettoEl.textContent = eur(netto);
    if (provEl) provEl.textContent = eur(provBetrag);
  });
  updateTotals();
}

function updateTotals() {
  let total = 0;
  formItems.forEach(item => {
    const brutto = parseFloat(item.brutto) || 0;
    const prov = parseFloat(item.provision) || 0;
    total += calcProv(calcNetto(brutto), prov);
  });
  $('fTotalProv').textContent = eur(total);
}

// ─── Form Open/Save ───
function openForm(id) {
  currentId = id;
  const inv = id ? invoices.find(i => i.id === id) : null;

  $('fNummer').value = inv ? inv.nummer : generateNummer();
  $('fDatum').value = inv ? inv.datum : new Date().toISOString().slice(0, 10);
  $('btnDelete').classList.toggle('hidden', !id);

  formItems = inv && inv.items && inv.items.length
    ? inv.items.map(i => ({ art: i.art, name: i.name, brutto: i.brutto, provision: i.provision }))
    : [];

  if (formItems.length === 0) addItemRow();
  else renderItems();

  showView('form', id ? 'Rechnung bearbeiten' : 'Neue Rechnung');
}

function generateNummer() {
  const year = new Date().getFullYear();
  const yearInv = invoices.filter(i => (i.nummer || '').startsWith(String(year)));
  return `${year}-${String(yearInv.length + 1).padStart(3, '0')}`;
}

async function saveInvoice(e) {
  e.preventDefault();
  syncItemsFromDOM();

  const items = formItems.map(fi => {
    const brutto = parseFloat(fi.brutto) || 0;
    const netto = calcNetto(brutto);
    const provision = parseFloat(fi.provision) || 0;
    return {
      art: fi.art,
      name: fi.name,
      brutto,
      netto,
      provision,
      provBetrag: calcProv(netto, provision)
    };
  });

  const inv = {
    id: currentId || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    nummer: $('fNummer').value,
    datum: $('fDatum').value,
    items,
    mwstSatz: settings.mwst,
    updatedAt: new Date().toISOString()
  };

  await dbPut(inv);
  currentId = inv.id;
  await loadInvoices();
  renderList();
  toast('Gespeichert \u2013 PDF wird erstellt...');

  await new Promise(r => setTimeout(r, 300));
  await generatePDF();
}

async function deleteInvoice() {
  if (!currentId || !confirm('Rechnung wirklich l\u00f6schen?')) return;
  await dbDelete(currentId);
  await loadInvoices();
  renderList();
  toast('Rechnung gel\u00f6scht');
  showView('list', 'Provisionen');
}

// ─── Detail View ───
function showDetail(id) {
  const inv = invoices.find(i => i.id === id);
  if (!inv) return;
  currentId = id;
  const items = inv.items || [];
  const total = items.reduce((s, i) => s + (i.provBetrag || 0), 0);

  let html = `
    <div class="detail-header">
      <h2>Provisionsabrechnung</h2>
      <div class="detail-nummer">${esc(inv.nummer || '\u2014')}</div>
      <div style="opacity:0.7;font-size:0.9rem;margin-top:4px">${datumFormat(inv.datum)}</div>
    </div>`;

  items.forEach((item, idx) => {
    html += `
    <div class="detail-rows">
      <div class="detail-row" style="background:#f0f5ff">
        <span class="detail-label" style="font-weight:700;color:var(--primary)">Position ${idx + 1}</span>
        <span class="detail-value">${esc(item.art || '\u2014')}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Nachname</span>
        <span class="detail-value">${esc(item.name || '\u2014')}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Rechnung (inkl. MwSt.)</span>
        <span class="detail-value">${eur(item.brutto)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Rechnung (ohne MwSt.)</span>
        <span class="detail-value">${eur(item.netto)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Provision</span>
        <span class="detail-value">${(item.provision || 0).toLocaleString('de-DE')} %</span>
      </div>
      <div class="detail-row highlight">
        <span class="detail-label">Provisionsbetrag</span>
        <span class="detail-value">${eur(item.provBetrag)}</span>
      </div>
    </div>`;
  });

  html += `
    <div class="detail-rows">
      <div class="detail-row highlight" style="border-top:2px solid var(--primary)">
        <span class="detail-label" style="font-weight:700">Gesamt</span>
        <span class="detail-value" style="font-size:1.3rem">${eur(total)}</span>
      </div>
    </div>`;

  $('detailContent').innerHTML = html;
  showView('detail', 'Rechnung ' + (inv.nummer || ''));
}

// ─── PDF ───
async function generatePDF() {
  const inv = invoices.find(i => i.id === currentId);
  if (!inv) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pw = 210, m = 20, cw = pw - 2 * m;
  let y = 0;

  doc.setFillColor(26, 54, 93);
  doc.rect(0, 0, pw, 40, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('Provisionsabrechnung', m, 18);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(settings.firma, m, 28);
  if (settings.adresse) { doc.setFontSize(9); doc.text(settings.adresse, m, 34); }
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Nr. ' + (inv.nummer || '\u2014'), pw - m, 18, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Datum: ' + datumFormat(inv.datum), pw - m, 28, { align: 'right' });
  doc.text('MwSt.: ' + (inv.mwstSatz || settings.mwst).toLocaleString('de-DE') + ' %', pw - m, 35, { align: 'right' });

  y = 50;
  doc.setTextColor(0, 0, 0);

  const cols = [
    { label: 'Art', x: m, w: 28 },
    { label: 'Nachname', x: m + 28, w: 30 },
    { label: 'Inkl. MwSt.', x: m + 58, w: 30 },
    { label: 'Ohne MwSt.', x: m + 88, w: 30 },
    { label: 'Prov. %', x: m + 118, w: 20 },
    { label: 'Provision \u20AC', x: m + 138, w: 32 }
  ];

  doc.setFillColor(240, 245, 255);
  doc.rect(m, y, cw, 10, 'F');
  doc.setDrawColor(180, 195, 215);
  doc.setLineWidth(0.3);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  cols.forEach(c => doc.text(c.label, c.x + 2, y + 7));
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const items = inv.items || [];

  items.forEach((item, idx) => {
    if (y > 265) { doc.addPage(); y = 20; }
    if (idx % 2 === 0) {
      doc.setFillColor(249, 250, 252);
      doc.rect(m, y, cw, 10, 'F');
    }
    doc.line(m, y, m + cw, y);
    doc.text(item.art || '\u2014', cols[0].x + 2, y + 7);
    doc.text(item.name || '\u2014', cols[1].x + 2, y + 7);
    doc.text(eur(item.brutto), cols[2].x + 2, y + 7);
    doc.text(eur(item.netto), cols[3].x + 2, y + 7);
    doc.text((item.provision || 0).toLocaleString('de-DE') + ' %', cols[4].x + 2, y + 7);
    doc.text(eur(item.provBetrag), cols[5].x + 2, y + 7);
    y += 10;
  });

  const totalProv = items.reduce((s, i) => s + (i.provBetrag || 0), 0);
  doc.setFillColor(26, 54, 93);
  doc.rect(m, y, cw, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Gesamt-Provisionsbetrag:', m + 4, y + 8);
  doc.text(eur(totalProv), m + cw - 4, y + 8, { align: 'right' });

  doc.setDrawColor(180, 195, 215);
  doc.setLineWidth(0.5);
  doc.rect(m, 50, cw, y + 12 - 50);

  y += 25;
  doc.setTextColor(120, 120, 120);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Erstellt am ' + new Date().toLocaleDateString('de-DE') + ' | ' + settings.firma, m, y);
  doc.setFillColor(26, 54, 93);
  doc.rect(0, 287, pw, 10, 'F');

  const names = items.map(i => i.name).filter(Boolean).join('_');
  const filename = `${(inv.nummer || 'Rechnung').replace(/[^a-zA-Z0-9-]/g, '_')}_${names.replace(/[^a-zA-Z0-9\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df]/gi, '_')}_${(inv.datum || '').replace(/-/g, '')}.pdf`;

  if (navigator.share) {
    try {
      const blob = doc.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Rechnung ' + inv.nummer });
        toast('PDF geteilt');
        showView('list', 'Provisionen');
        return;
      }
    } catch (err) {
      if (err.name === 'AbortError') { showView('list', 'Provisionen'); return; }
    }
  }

  doc.save(filename);
  toast('PDF heruntergeladen');
  showView('list', 'Provisionen');
}

// ─── Export / Import ───
function exportData() {
  const blob = new Blob([JSON.stringify({ settings, invoices, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `provisionen_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Daten exportiert');
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.settings) {
      Object.assign(settings, data.settings);
      localStorage.setItem('provSettings', JSON.stringify(settings));
      loadSettings();
    }
    if (Array.isArray(data.invoices)) {
      for (const inv of data.invoices) await dbPut(inv);
      await loadInvoices();
      renderList();
    }
    toast(`${(data.invoices || []).length} Rechnungen importiert`);
  } catch (e) { toast('Import fehlgeschlagen'); }
}

async function clearAllData() {
  if (!confirm('Wirklich ALLE Daten l\u00f6schen?')) return;
  await dbClear();
  await loadInvoices();
  renderList();
  toast('Alle Daten gel\u00f6scht');
  showView('list', 'Provisionen');
}

// ─── Toast ───
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); t.classList.add('hidden'); }, 2200);
}

// ─── Events ───
function bindEvents() {
  $('btnBack').addEventListener('click', () => showView('list', 'Provisionen'));
  $('btnSettings').addEventListener('click', () => showView('settings', 'Einstellungen'));
  $('btnNewTop').addEventListener('click', () => openForm(null));
  $('btnNew').addEventListener('click', () => openForm(null));
  $('searchInput').addEventListener('input', renderList);
  $('invoiceList').addEventListener('click', e => {
    const item = e.target.closest('.invoice-item');
    if (item) showDetail(item.dataset.id);
  });
  $('invoiceForm').addEventListener('submit', saveInvoice);
  $('btnDelete').addEventListener('click', deleteInvoice);
  $('btnAddItem').addEventListener('click', () => { syncItemsFromDOM(); addItemRow(); });
  $('btnPdf').addEventListener('click', generatePDF);
  $('btnEdit').addEventListener('click', () => openForm(currentId));
  $('btnSaveSettings').addEventListener('click', saveSettings);
  $('btnExport').addEventListener('click', exportData);
  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
  $('btnClearAll').addEventListener('click', clearAllData);
  $('btnLogout').addEventListener('click', () => AuthClient.signOut());
}
