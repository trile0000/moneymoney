// Wizard nhập CSV/XLSX 3 bước (P1d-2): file → dòng tiêu đề & mẫu → ánh xạ cột → xem trước & nhập.
// XLSX đọc bằng SheetJS mini (vendor/xlsx.mini.min.js, nạp lười). Không innerHTML.
import * as S from '../state.js';
import { $, el, clear } from '../utils/dom.js';
import { formatVND } from '../utils/money.js';
import { dateLabel } from '../utils/date.js';
import { parseCSV } from '../utils/csv.js';
import { t } from '../i18n.js';
import { openFormSheet } from './formSheet.js';
import { fillAccountSelect } from './pickers.js';
import { showToast } from './toast.js';
import { BANK_PRESETS, DATE_FORMATS, detectHeaderRow, detectPreset, guessMapping, applyMapping, buildLearnedMap, cellText } from '../features/csvWizard.js';
import { dedupeAgainst } from '../features/importExport.js';

const MAP_FIELDS = ['date', 'amount', 'debit', 'credit', 'note', 'category', 'type', 'account', 'id'];

async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  await new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/xlsx.mini.min.js'; sc.async = true;
    sc.onload = resolve; sc.onerror = () => reject(new Error(t('csvw.errXlsxLib')));
    document.head.appendChild(sc);
  });
  return window.XLSX;
}

/** Đọc file → { sheets: [{ name, rows }] } */
export async function readTabular(file) {
  const name = String(file.name || '').toLowerCase();
  if (/\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    const XLSX = await loadXLSX();
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
    return { sheets: wb.SheetNames.map((n) => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) })).filter((s) => s.rows.length) };
  }
  const text = await file.text();
  return { sheets: [{ name: 'CSV', rows: parseCSV(text) }] };
}

/** Bảng xem trước (tối đa n dòng, m cột) */
function previewTable(rows, { headerIndex = 0, limit = 6, maxCols = 8, highlight = null } = {}) {
  const table = el('table', { className: 'sched csvw-table' });
  const hdr = rows[headerIndex] || [];
  const cols = Math.min(maxCols, Math.max(hdr.length, ...(rows.slice(headerIndex + 1, headerIndex + 1 + limit).map((r) => r.length))));
  const thead = el('thead', {}, [el('tr', {}, Array.from({ length: cols }, (_, i) => el('th', { text: `${i + 1}. ${cellText(hdr[i]).slice(0, 18) || '—'}`, className: highlight && highlight.has(i) ? 'on' : '' })))]);
  const tb = el('tbody');
  for (const r of rows.slice(headerIndex + 1, headerIndex + 1 + limit)) tb.appendChild(el('tr', {}, Array.from({ length: cols }, (_, i) => el('td', { text: cellText(r[i]).slice(0, 22) }))));
  table.append(thead, tb);
  return el('div', { className: 'sched-wrap' }, [table]);
}

/**
 * Mở wizard cho file đã chọn. onImport(items) → Promise<number>
 */
export async function openCsvWizard(file, { onImport }) {
  let data;
  try { data = await readTabular(file); }
  catch (e) { showToast(e.message || t('data.importFail'), { kind: 'error' }); return; }
  if (!data.sheets.length || !data.sheets[0].rows.length) { showToast(t('data.importNoRows'), { kind: 'warn' }); return; }
  const templates = S.getSettings().csvTemplates || [];
  const st = { sheetIdx: 0, rows: data.sheets[0].rows, headerIndex: 0, presetKey: 'auto', map: {}, dateFormat: 'auto', autoCategory: true, accountId: S.getSettings().lastAccountId || S.getSettings().defaultAccountId, useFileAccount: false, templateName: '' };
  st.headerIndex = detectHeaderRow(st.rows);
  const detected = detectPreset(st.rows[st.headerIndex] || []);
  if (detected) st.presetKey = detected.key;

  // ---------- Bước 1 ----------
  const step1 = () => new Promise((resolve) => {
    const presetOptions = [...BANK_PRESETS.map((p) => ({ value: p.key, label: p.name })), ...templates.map((tp, i) => ({ value: 'tpl:' + i, label: `⭐ ${tp.name}` }))];
    const fields = [];
    if (data.sheets.length > 1) fields.push({ key: 'sheet', label: t('csvw.sheet'), type: 'select', options: data.sheets.map((s, i) => ({ value: String(i), label: `${s.name} (${s.rows.length})` })), onChange: (a) => { st.sheetIdx = Number(a.getValues().sheet) || 0; st.rows = data.sheets[st.sheetIdx].rows; st.headerIndex = detectHeaderRow(st.rows); a.setValue('header', String(st.headerIndex + 1)); redraw(a); } });
    fields.push({ type: 'row2', fields: [
      { key: 'preset', label: t('csvw.preset'), type: 'select', options: presetOptions, onChange: (a) => { st.presetKey = a.getValues().preset; } },
      { key: 'header', label: t('csvw.headerRow'), type: 'number', attrs: { min: 1, max: 200 }, hint: t('csvw.headerHint'), onInput: (a) => { const n = Number(a.getValues().header) || 1; st.headerIndex = Math.max(0, Math.min(st.rows.length - 1, n - 1)); redraw(a); } },
    ] });
    let box = null;
    const redraw = (a) => { if (!box) return; clear(box); box.appendChild(el('div', { className: 'hint', text: t('csvw.previewHint', { n: st.rows.length - st.headerIndex - 1, file: file.name }) })); box.appendChild(previewTable(st.rows, { headerIndex: st.headerIndex })); };
    const api = openFormSheet({
      title: t('csvw.title1'),
      fields, values: { sheet: '0', preset: st.presetKey, header: String(st.headerIndex + 1) },
      saveText: t('onb.next'),
      onSave: (v, a) => { st.presetKey = v.preset; a.close(); resolve(true); },
    });
    box = el('div', { className: 'csvw-preview' });
    api.root.appendChild(box); redraw(api);
    watchClose(() => resolve(false));
  });

  // ---------- Bước 2 ----------
  const step2 = () => new Promise((resolve) => {
    const hdr = st.rows[st.headerIndex] || [];
    let preset = null, tpl = null;
    if (st.presetKey.startsWith('tpl:')) tpl = templates[Number(st.presetKey.slice(4))] || null;
    else preset = BANK_PRESETS.find((p) => p.key === st.presetKey) || null;
    if (tpl) { preset = { map: tpl.map, dateFormat: tpl.dateFormat }; st.autoCategory = tpl.autoCategory !== false; }
    if (!Object.keys(st.map).length) st.map = guessMapping(hdr, preset);
    if (preset && preset.dateFormat && st.dateFormat === 'auto') st.dateFormat = preset.dateFormat;
    const colOptions = [{ value: '', label: '—' }, ...hdr.map((h, i) => ({ value: String(i), label: `${i + 1}. ${cellText(h).slice(0, 28) || '(trống)'}` }))];
    const fieldSel = (key, required) => ({ key: 'col_' + key, label: (required ? '★ ' : '') + t('csvw.f.' + key), type: 'select', options: colOptions, onChange: (a) => { readMap(a); refresh(a); } });
    const fields = [
      { type: 'row2', fields: [fieldSel('date', true), fieldSel('note')] },
      { type: 'row2', fields: [fieldSel('amount'), fieldSel('type')] },
      { type: 'row2', fields: [fieldSel('debit'), fieldSel('credit')] },
      { type: 'row2', fields: [fieldSel('category'), fieldSel('id')] },
      { type: 'row2', fields: [
        { key: 'dateFormat', label: t('csvw.dateFormat'), type: 'select', options: DATE_FORMATS.map((f) => ({ value: f, label: t('csvw.df.' + f) })), onChange: (a) => { st.dateFormat = a.getValues().dateFormat; refresh(a); } },
        { key: 'account', label: t('csvw.account'), type: 'select', options: [] },
      ] },
      { key: 'useFileAccount', label: t('csvw.useFileAccount'), type: 'checkbox' },
      { key: 'autoCategory', label: t('csvw.autoCategory'), type: 'checkbox' },
      { key: 'templateName', label: t('csvw.saveTemplate'), type: 'text', placeholder: 'VD: Sao kê VCB' },
    ];
    const values = { dateFormat: st.dateFormat, useFileAccount: st.useFileAccount, autoCategory: st.autoCategory, templateName: '' };
    for (const k of MAP_FIELDS) values['col_' + k] = st.map[k] === undefined ? '' : String(st.map[k]);
    const readMap = (a) => { const v = a.getValues(); st.map = {}; for (const k of MAP_FIELDS) if (v['col_' + k] !== '') st.map[k] = Number(v['col_' + k]); };
    let box = null;
    const refresh = (a) => {
      if (!box) return; clear(box);
      const r = applyMapping(st.rows, { headerIndex: st.headerIndex, map: st.map, dateFormat: st.dateFormat, autoCategory: false });
      const okTxt = t('csvw.parsedHint', { ok: r.items.length, total: r.stats.total, err: r.errors.length, fmt: t('csvw.df.' + r.dateFormatUsed) });
      box.appendChild(el('div', { className: 'hint' + (r.items.length ? ' ok' : ' err'), text: okTxt }));
      if (r.errors.length) box.appendChild(el('div', { className: 'hint', text: r.errors.slice(0, 3).join(' · ') }));
      box.appendChild(previewTable(st.rows, { headerIndex: st.headerIndex, limit: 4, highlight: new Set(Object.values(st.map)) }));
    };
    const api = openFormSheet({
      title: t('csvw.title2'),
      fields, values,
      saveText: t('onb.next'),
      onSave: async (v) => {
        readMap(api);
        if (st.map.date === undefined) throw Object.assign(new Error(t('csvw.errNeedDate')), { focusKey: 'col_date' });
        if (st.map.amount === undefined && st.map.debit === undefined && st.map.credit === undefined) throw Object.assign(new Error(t('csvw.errNeedAmount')), { focusKey: 'col_amount' });
        st.dateFormat = v.dateFormat; st.autoCategory = !!v.autoCategory; st.useFileAccount = !!v.useFileAccount; st.accountId = v.account; st.templateName = String(v.templateName || '').trim();
        api.close(); resolve(true);
      },
      extraText: t('csvw.back'), onExtra: (a) => { a.close(); resolve('back'); },
    });
    fillAccountSelect(api.ctl('account').el, { value: st.accountId, includeArchived: false });
    box = el('div', { className: 'csvw-preview' });
    api.root.appendChild(box); refresh(api);
    watchClose(() => resolve(false));
  });

  // ---------- Bước 3 ----------
  const step3 = () => new Promise((resolve) => {
    const cats = S.getCategories({ includeArchived: true });
    const nameOf = (id, tx) => { const c = cats.find((x) => x.id === id); return c ? c.name : tx.category; };
    const learned = st.autoCategory ? buildLearnedMap(S.getVisible(), nameOf) : null;
    const r = applyMapping(st.rows, { headerIndex: st.headerIndex, map: st.map, dateFormat: st.dateFormat, autoCategory: st.autoCategory, learned });
    const accByName = new Map(S.getAccounts({ includeArchived: true }).map((a) => [a.name.trim().toLowerCase(), a.id]));
    for (const it of r.items) {
      const fromFile = st.useFileAccount && it.accountName ? accByName.get(it.accountName.trim().toLowerCase()) : null;
      it.accountId = fromFile || st.accountId || S.getSettings().defaultAccountId;
    }
    const { fresh, dupes } = dedupeAgainst(r.items, S.getAllRaw());
    const byCat = new Map(); for (const x of fresh) byCat.set(x.category, (byCat.get(x.category) || 0) + 1);
    const catSummary = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c} (${n})`).join(', ');
    const api = openFormSheet({
      title: t('csvw.title3'),
      fields: [], values: {},
      saveText: t('data.importOk', { n: fresh.length }),
      onSave: async () => {
        if (!fresh.length) throw new Error(t('data.importNoRows'));
        if (st.templateName) {
          const hdr = st.rows[st.headerIndex] || [];
          const mapByName = {}; for (const [k, i] of Object.entries(st.map)) mapByName[k] = cellText(hdr[i]);
          const list = (S.getSettings().csvTemplates || []).filter((x) => x.name !== st.templateName);
          list.push({ name: st.templateName, map: mapByName, dateFormat: st.dateFormat, autoCategory: st.autoCategory });
          await S.updateSettings({ csvTemplates: list.slice(-20) }, { silent: true });
        }
        const n = await onImport(fresh);
        showToast(t('data.imported', { n }));
        api.close(); resolve(true);
      },
      extraText: t('csvw.back'), onExtra: (a) => { a.close(); resolve('back'); },
    });
    const box = api.root;
    box.appendChild(el('div', { className: 'status-bar ' + (fresh.length ? 'status--rich' : 'status--poor'), text: t('csvw.summary', { total: r.stats.total, ok: r.items.length, dupes, fresh: fresh.length, err: r.errors.length }) }));
    if (r.errors.length) box.appendChild(el('div', { className: 'note-box danger', text: r.errors.slice(0, 5).join('\n') + (r.errors.length > 5 ? '\n…' : '') }));
    if (catSummary) box.appendChild(el('div', { className: 'hint', text: t('csvw.catSummary', { list: catSummary }) }));
    const table = el('table', { className: 'sched csvw-table' });
    table.appendChild(el('thead', {}, [el('tr', {}, [t('tx.date'), t('tx.amount'), t('tx.category'), t('tx.note')].map((h) => el('th', { text: h })))]));
    const tb = el('tbody');
    for (const x of fresh.slice(0, 10)) tb.appendChild(el('tr', {}, [el('td', { text: dateLabel(x.date) }), el('td', { className: x.type === 'income' ? 'in' : 'out', text: (x.type === 'income' ? '+' : '−') + formatVND(x.amount, { withUnit: false }) }), el('td', { text: x.category }), el('td', { text: x.note.slice(0, 40) })]));
    table.appendChild(tb);
    box.appendChild(el('div', { className: 'sched-wrap' }, [table]));
    if (fresh.length > 10) box.appendChild(el('div', { className: 'hint', text: `… +${fresh.length - 10}` }));
    watchClose(() => resolve(false));
  });

  // ---------- Điều phối ----------
  let step = 1;
  while (step >= 1 && step <= 3) {
    const r = step === 1 ? await step1() : step === 2 ? await step2() : await step3();
    if (r === false) return;           // đóng
    if (r === 'back') { step--; if (step === 1) st.map = {}; continue; }
    if (step === 3) return;
    step++;
  }
}

/** Gọi cb khi sheet bị đóng (✕/Esc) mà chưa resolve */
function watchClose(cb) {
  const modal = document.getElementById('formSheet');
  const obs = new MutationObserver(() => { if (modal.getAttribute('aria-hidden') === 'true') { obs.disconnect(); cb(); } });
  obs.observe(modal, { attributes: true, attributeFilter: ['aria-hidden'] });
}
