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
  item = item || { nummer: '', datum: new Date().toISOString().slice(0, 10), art: '', name: '', brutto: '', provision: '' };
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
        <label>Rechnungsnummer</label>
        <input type="text" class="fi-nummer" data-idx="${idx}" value="${esc(item.nummer || '')}" placeholder="z.B. 2026-001" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Zahlungseingang (Datum)</label>
        <input type="date" class="fi-datum" data-idx="${idx}" value="${item.datum || new Date().toISOString().slice(0, 10)}">
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
  document.querySelectorAll('.fi-nummer').forEach(el => { formItems[el.dataset.idx].nummer = el.value; });
  document.querySelectorAll('.fi-datum').forEach(el => { formItems[el.dataset.idx].datum = el.value; });
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
  $('btnDelete').classList.toggle('hidden', !id);

  formItems = inv && inv.items && inv.items.length
    ? inv.items.map(i => ({ nummer: i.nummer || inv.nummer || '', datum: i.datum || inv.datum || '', art: i.art, name: i.name, brutto: i.brutto, provision: i.provision }))
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
      nummer: fi.nummer || '',
      datum: fi.datum || '',
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
    nummer: (items[0]?.datum || '').slice(0, 7) || '',
    datum: items[0]?.datum || '',
    items,
    mwstSatz: settings.mwst,
    updatedAt: new Date().toISOString()
  };

  await dbPut(inv);
  currentId = inv.id;
  await loadInvoices();
  renderList();
  toast('Gespeichert \u2013 PDF wird erstellt...');
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
        <span class="detail-label">Re.-Nr.</span>
        <span class="detail-value">${esc(item.nummer || inv.nummer || '\u2014')}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Zahlungseingang</span>
        <span class="detail-value">${datumFormat(item.datum || inv.datum)}</span>
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
  if (!inv) { showView('list', 'Provisionen'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pw = 210, m = 18, cw = pw - 2 * m;
  const items = inv.items || [];
  const totalProv   = items.reduce((s, i) => s + (i.provBetrag || 0), 0);
  const totalBrutto = items.reduce((s, i) => s + (i.brutto || 0), 0);
  const totalNetto  = items.reduce((s, i) => s + (i.netto || 0), 0);
  const monat = inv.datum ? new Date(inv.datum).toLocaleString('de-DE', { month: 'long', year: 'numeric' }) : '';
  let y = 0;

  // Header
  doc.setFillColor(26, 54, 93);
  doc.rect(0, 0, pw, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('PROVISIONSABRECHNUNG', m, 15);
  doc.setFontSize(11);
  doc.text(settings.firma, pw - m, 13, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Brenztal-Immobilien GmbH', pw - m, 20, { align: 'right' });
  if (settings.adresse) doc.text(settings.adresse, pw - m, 26, { align: 'right' });

  // Meta
  y = 42;
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Monat:', m, y);
  doc.setFont('helvetica', 'normal');
  doc.text(monat, m + 18, y);
  doc.setFont('helvetica', 'bold');
  doc.text('MwSt.:', pw - m - 30, y);
  doc.setFont('helvetica', 'normal');
  doc.text((inv.mwstSatz || settings.mwst).toLocaleString('de-DE') + ' %', pw - m - 14, y);
  y += 6;
  doc.setDrawColor(26, 54, 93);
  doc.setLineWidth(0.6);
  doc.line(m, y, pw - m, y);

  // Tabelle
  y += 5;
  const colDef = [
    { label: 'Art der\nVermittlung',                          w: 20, align: 'left' },
    { label: 'K\u00e4ufer/Verk\u00e4ufer/\nMieter/Vermieter', w: 30, align: 'left' },
    { label: 'Re.-Nr.',                                       w: 16, align: 'center' },
    { label: 'Zahlungs-\neingang',                            w: 20, align: 'center' },
    { label: 'Rechnung\ninkl. MwSt.',                         w: 26, align: 'right' },
    { label: 'Rechnung\nohne MwSt.',                          w: 24, align: 'right' },
    { label: 'Provision\nKeefer %',                           w: 16, align: 'center' },
    { label: 'Provisions-\nbetrag \u20AC',                    w: 22, align: 'right' }
  ];
  let cx = m;
  colDef.forEach(c => { c.x = cx; cx += c.w; });

  const headH = 14;
  doc.setFillColor(26, 54, 93);
  doc.rect(m, y, cw, headH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  colDef.forEach((c, ci) => {
    const lines = c.label.split('\n');
    const ly = lines.length > 1 ? y + 5 : y + 8;
    lines.forEach((line, li) => {
      const tx = c.align === 'right' ? c.x + c.w - 3 : c.align === 'center' ? c.x + c.w / 2 : c.x + 3;
      doc.text(line, tx, ly + li * 4, { align: c.align === 'left' ? 'left' : c.align });
    });
    if (ci > 0) { doc.setDrawColor(80, 110, 150); doc.setLineWidth(0.2); doc.line(c.x, y + 2, c.x, y + headH - 2); }
  });
  y += headH;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const baseRowH = 9, lineH = 3.5, pad = 2.5;
  const tableStartY = y;

  items.forEach((item, idx) => {
    doc.setFontSize(8);
    const artLines  = doc.splitTextToSize(item.art  || '', colDef[0].w - 2 * pad);
    const nameLines = doc.splitTextToSize(item.name || '', colDef[1].w - 2 * pad);
    doc.setFontSize(7);
    const numLines  = doc.splitTextToSize(item.nummer || inv.nummer || '', colDef[2].w - 2 * pad);
    doc.setFontSize(8);
    const maxLines = Math.max(artLines.length, nameLines.length, numLines.length, 1);
    const rowH = Math.max(baseRowH, maxLines * lineH + 2 * pad);

    if (y + rowH > 220) { doc.addPage(); y = 20; }

    doc.setFillColor(idx % 2 === 0 ? 245 : 255, idx % 2 === 0 ? 248 : 255, idx % 2 === 0 ? 253 : 255);
    doc.rect(m, y, cw, rowH, 'F');
    doc.setDrawColor(200, 210, 225); doc.setLineWidth(0.2);
    doc.rect(m, y, cw, rowH);
    colDef.forEach((c, ci) => { if (ci > 0) doc.line(c.x, y, c.x, y + rowH); });

    doc.setTextColor(30, 30, 30);
    const centerY = y + rowH / 2;
    const singleY = centerY + 2.5;

    doc.setFontSize(8);
    const artStartY = centerY - ((artLines.length - 1) * lineH / 2) + 2.5;
    artLines.forEach((line, li) => doc.text(line, colDef[0].x + pad, artStartY + li * lineH));
    const nameStartY = centerY - ((nameLines.length - 1) * lineH / 2) + 2.5;
    nameLines.forEach((line, li) => doc.text(line, colDef[1].x + pad, nameStartY + li * lineH));
    doc.setFontSize(7);
    const numStartY = centerY - ((numLines.length - 1) * lineH / 2) + 2.5;
    numLines.forEach((line, li) => doc.text(line, colDef[2].x + colDef[2].w / 2, numStartY + li * lineH, { align: 'center' }));
    doc.text(datumFormat(item.datum || inv.datum), colDef[3].x + colDef[3].w / 2, singleY, { align: 'center' });
    doc.setFontSize(8);
    doc.text(eur(item.brutto),   colDef[4].x + colDef[4].w - pad, singleY, { align: 'right' });
    doc.text(eur(item.netto),    colDef[5].x + colDef[5].w - pad, singleY, { align: 'right' });
    doc.text((item.provision || 0).toLocaleString('de-DE') + ' %', colDef[6].x + colDef[6].w / 2, singleY, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.text(eur(item.provBetrag), colDef[7].x + colDef[7].w - pad, singleY, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    y += rowH;
  });

  // Summenzeile
  doc.setFillColor(26, 54, 93);
  doc.rect(m, y, cw, 11, 'F');
  colDef.forEach((c, ci) => { if (ci > 0) { doc.setDrawColor(60, 90, 130); doc.setLineWidth(0.2); doc.line(c.x, y, c.x, y + 11); } });
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('SUMME', colDef[0].x + 3, y + 7.5);
  doc.text(eur(totalBrutto), colDef[4].x + colDef[4].w - pad, y + 7.5, { align: 'right' });
  doc.text(eur(totalNetto),  colDef[5].x + colDef[5].w - pad, y + 7.5, { align: 'right' });
  doc.setFontSize(9);
  doc.text(eur(totalProv),   colDef[7].x + colDef[7].w - pad, y + 7.5, { align: 'right' });
  y += 11;

  doc.setDrawColor(26, 54, 93); doc.setLineWidth(0.5);
  doc.rect(m, tableStartY, cw, y - tableStartY);

  // ── Unterschriftenfelder ──
  y += 14;
  const sigW = (cw - 14) / 3;
  const sigLabels = ['Erstellt:', 'Gepr\u00fcft:', 'Genehmigt:'];
  sigLabels.forEach((lbl, i) => {
    const sx = m + i * (sigW + 7);
    // Rahmen
    doc.setDrawColor(26, 54, 93);
    doc.setLineWidth(0.3);
    doc.rect(sx, y, sigW, 18);
    // Label oben links
    doc.setTextColor(26, 54, 93);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(lbl, sx + 2.5, y + 5);
    // Unterschriftslinie
    doc.setDrawColor(100, 120, 150);
    doc.setLineWidth(0.3);
    doc.line(sx + 2.5, y + 14, sx + sigW - 2.5, y + 14);
    // "Datum / Unterschrift" Beschriftung
    doc.setTextColor(140, 140, 140);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text('Datum / Unterschrift', sx + sigW / 2, y + 17, { align: 'center' });
  });
  y += 18;

  // Footer
  y += 8;
  doc.setTextColor(120, 120, 120);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Erstellt am ' + new Date().toLocaleDateString('de-DE') + ' | ' + settings.firma, m, y);
  doc.setFillColor(26, 54, 93);
  doc.rect(0, 287, pw, 10, 'F');

  const names = items.map(i => i.name).filter(Boolean).join('_');
  const filename = `Provision_${monat.replace(/\s/g, '_')}_${names.replace(/[^a-zA-Z0-9\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df]/gi, '_')}.pdf`;

  const blob = doc.output('blob');

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: 'application/pdf' })] })) {
    try {
      await navigator.share({ files: [new File([blob], filename, { type: 'application/pdf' })], title: filename });
      toast('PDF geteilt');
      showView('list', 'Provisionen');
      return;
    } catch (err) {
      if (err.name === 'AbortError') { showView('list', 'Provisionen'); return; }
      // Bei anderen Fehlern (z.B. NotAllowedError) → Download-Fallback
    }
  }

  // Download-Fallback
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
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
  $('btnPdf').addEventListener('click', () => generatePDF().catch(e => toast('Fehler: ' + e.message)));
  $('btnEdit').addEventListener('click', () => openForm(currentId));
  $('btnSaveSettings').addEventListener('click', saveSettings);
  $('btnExport').addEventListener('click', exportData);
  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
  $('btnClearAll').addEventListener('click', clearAllData);
  $('btnLogout').addEventListener('click', () => AuthClient.signOut());
  $('btnHeaderLogout').addEventListener('click', () => {
    if (confirm('Wirklich abmelden?')) AuthClient.signOut();
  });
}
