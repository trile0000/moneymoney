// Biểu đồ (Chart.js self-host). Nhận dữ liệu từ chỉ mục — không load() lại (lỗi #20).
// Ghi rõ phạm vi dữ liệu (lỗi #27) + mô tả text cho trình đọc màn hình (lỗi #26). Chuyển khoản không tính vào thu/chi.
import { formatVND } from '../utils/money.js';
import { t, monthLabelL } from '../i18n.js';
import { isDark } from './theme.js';
import { el, clear } from '../utils/dom.js';
import { addMonths, toLocalYM, dateLabel } from '../utils/date.js';

let chart = null;
let chartLoading = null;
/** Nạp Chart.js lười (self-host) — chỉ khi cần vẽ, giảm JS tải lúc mở app. */
export function ensureChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!chartLoading) {
    chartLoading = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'vendor/chart.umd.js'; sc.async = true;
      sc.onload = () => resolve(window.Chart);
      sc.onerror = () => { chartLoading = null; reject(new Error('chart-load-failed')); };
      document.head.appendChild(sc);
    });
  }
  return chartLoading;
}

function palette(n) {
  const base = ['#b3261e', '#2e7d32', '#7A2A1A', '#ef6c00', '#1565c0', '#6a1b9a', '#00897b', '#c2185b', '#455a64', '#8e24aa', '#43a047', '#1e88e5', '#5d4037', '#f9a825', '#00acc1'];
  return Array.from({ length: n }, (_, i) => base[i % base.length]);
}
const TREND_MONTHS = 12;

export function renderChart({ canvas, scopeEl, heatmapEl, mode, type, monthKey, month, monthIndex, categoryOf }) {
  if (heatmapEl) { heatmapEl.hidden = mode !== 'heatmap'; clear(heatmapEl); }
  if (canvas) canvas.hidden = mode === 'heatmap';
  if (mode === 'heatmap') {
    if (chart) { try { chart.destroy(); } catch { /* ignore */ } chart = null; }
    const key = monthKey || toLocalYM();
    const info = renderHeatmap(heatmapEl, monthIndex.get(key) || month, key);
    if (scopeEl) scopeEl.textContent = t('chart.scopeHeatmap', { scope: monthLabelL(key) });
    if (heatmapEl) heatmapEl.setAttribute('aria-label', t('chart.ariaHeatmap', { scope: monthLabelL(key), day: info.maxDay ? dateLabel(info.maxDay) : '—', amount: formatVND(info.max) }));
    return;
  }
  if (!canvas) return;
  if (typeof window.Chart === 'undefined') {
    // nạp lười rồi vẽ lại với đúng tham số hiện tại
    const args = { canvas, scopeEl, heatmapEl, mode, type, monthKey, month, monthIndex, categoryOf };
    ensureChart().then(() => renderChart(args)).catch(() => { if (scopeEl) scopeEl.textContent = t('chart.libFail'); });
    return;
  }
  if (chart) { try { chart.destroy(); } catch { /* ignore */ } chart = null; }
  const dark = isDark();
  const textColor = dark ? '#e8dcd7' : '#4a3f3b';
  const gridColor = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
  window.Chart.defaults.color = textColor;
  window.Chart.defaults.borderColor = gridColor;
  window.Chart.defaults.font.family = "'Baloo 2', 'Quicksand', system-ui, sans-serif";

  const scopeMonth = monthKey ? monthLabelL(monthKey) : t('chart.allTime');
  let scopeText = '', aria = '';
  const common = { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: type === 'doughnut' ? 'bottom' : 'top' } } };
  const axes = type === 'line' || type === 'bar' ? { y: { beginAtZero: true, ticks: { callback: (v) => compact(v) } } } : undefined;

  if (mode === 'trend') {
    const months = Array.from(monthIndex.keys()).sort();
    const shown = months.slice(-TREND_MONTHS);
    const labels = shown.map(monthLabelL);
    const inc = shown.map((m) => monthIndex.get(m).income);
    const exp = shown.map((m) => monthIndex.get(m).expense);
    const tt = type === 'doughnut' ? 'bar' : type;
    chart = new Chart(canvas, {
      type: tt,
      data: { labels, datasets: [
        { label: t('chart.incomeLabel'), data: inc, borderColor: '#2e7d32', backgroundColor: tt === 'bar' ? '#2e7d32' : 'rgba(46,125,50,.15)', tension: .3, fill: false },
        { label: t('chart.expenseLabel'), data: exp, borderColor: '#b3261e', backgroundColor: tt === 'bar' ? '#b3261e' : 'rgba(179,38,30,.15)', tension: .3, fill: false },
      ] },
      options: { ...common, scales: { y: { beginAtZero: true, ticks: { callback: (v) => compact(v) } } } },
    });
    scopeText = t('chart.scopeTrend', { n: shown.length });
    aria = t('chart.ariaTrend', { n: shown.length }) + shown.map((m, i) => `${monthLabelL(m)}: ${t('chart.income')} ${formatVND(inc[i])}, ${t('chart.expense')} ${formatVND(exp[i])}`).join('; ');
  } else if (mode === 'cashflow') {
    const key = monthKey || toLocalYM();
    const m = monthIndex.get(key) || { items: [] };
    const [y, mo] = key.split('-').map(Number);
    const days = new Date(y, mo, 0).getDate();
    const daily = new Array(days).fill(0);
    for (const tx of m.items) { const d = Number(tx.date.slice(8, 10)) - 1; if (d < 0 || d >= days) continue; if (tx.type === 'income') daily[d] += tx.amount; else if (tx.type === 'expense') daily[d] -= tx.amount; }
    const cum = []; let acc = 0; for (const v of daily) { acc += v; cum.push(acc); }
    const labels = Array.from({ length: days }, (_, i) => String(i + 1));
    const tt = type === 'doughnut' ? 'line' : type;
    chart = new Chart(canvas, {
      type: tt,
      data: { labels, datasets: [{ label: t('chart.cumulative'), data: cum, borderColor: '#8B2E1A', backgroundColor: tt === 'bar' ? cum.map((v) => (v >= 0 ? '#2e7d32' : '#b3261e')) : 'rgba(139,46,26,.12)', fill: tt === 'line', tension: .25, pointRadius: 2 }] },
      options: { ...common, plugins: { ...common.plugins, tooltip: { callbacks: { label: (c) => ` ${formatVND(c.parsed.y)}` } } }, scales: { y: { ticks: { callback: (v) => compact(v) } } } },
    });
    scopeText = t('chart.scopeCashflow', { scope: monthLabelL(key) });
    aria = t('chart.ariaCashflow', { scope: monthLabelL(key), end: formatVND(cum[cum.length - 1] || 0) });
  } else if (mode === 'compare') {
    const key = monthKey || toLocalYM();
    const prevKey = addMonths(key, -1);
    const rootOf = (id) => { let c = categoryOf ? categoryOf(id) : null; let g = 0; while (c && c.parentId && g++ < 8) { const p = categoryOf(c.parentId); if (!p) break; c = p; } return c; };
    const agg = (mm) => { const map = new Map(); for (const tx of (mm ? mm.items : [])) { if (tx.type !== 'expense') continue; const c = rootOf(tx.categoryId); const k = c ? c.id : (tx.category || '?'); const cur = map.get(k) || { name: c ? `${c.icon} ${c.name}` : (tx.category || 'Khác'), value: 0 }; cur.value += tx.amount; map.set(k, cur); } return map; };
    const a = agg(monthIndex.get(key)), b = agg(monthIndex.get(prevKey));
    const keys = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => ((b.get(y) || {}).value || 0) + ((a.get(y) || {}).value || 0) - (((b.get(x) || {}).value || 0) + ((a.get(x) || {}).value || 0))).slice(0, 8);
    const labels = keys.map((k) => (a.get(k) || b.get(k)).name);
    const cur = keys.map((k) => (a.get(k) || {}).value || 0), prev = keys.map((k) => (b.get(k) || {}).value || 0);
    const tt = type === 'doughnut' ? 'bar' : type;
    chart = new Chart(canvas, {
      type: tt,
      data: { labels: labels.length ? labels : [t('chart.noData')], datasets: [
        { label: `${t('chart.prevMonth')} (${monthLabelL(prevKey)})`, data: prev, backgroundColor: 'rgba(158,158,158,.7)', borderColor: '#9e9e9e', fill: false, tension: .3 },
        { label: `${t('chart.thisMonth')} (${monthLabelL(key)})`, data: cur, backgroundColor: '#8B2E1A', borderColor: '#8B2E1A', fill: false, tension: .3 },
      ] },
      options: { ...common, plugins: { ...common.plugins, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatVND(c.parsed.y)}` } } }, scales: { y: { beginAtZero: true, ticks: { callback: (v) => compact(v) } } } },
    });
    scopeText = t('chart.scopeCompare', { scope: monthLabelL(key), prev: monthLabelL(prevKey) });
    aria = t('chart.ariaCompare', { scope: monthLabelL(key), prev: monthLabelL(prevKey) }) + labels.map((l, i) => `${l}: ${formatVND(cur[i])} vs ${formatVND(prev[i])}`).join('; ');
  } else if (mode === 'totals') {
    const values = [month.income, month.expense];
    const colors = ['#2e7d32', '#b3261e'];
    chart = new Chart(canvas, {
      type,
      data: { labels: [t('chart.inOut'), t('chart.out')], datasets: [{ label: t('chart.totals'), data: values, backgroundColor: colors, borderColor: colors, fill: false, tension: .3 }] },
      options: { ...common, scales: axes },
    });
    scopeText = t('chart.scopeMonth', { scope: scopeMonth });
    aria = t('chart.ariaTotals', { scope: scopeMonth, income: formatVND(month.income), expense: formatVND(month.expense) });
  } else {
    const map = new Map();
    for (const tx of month.items) {
      if (tx.type !== 'expense') continue;
      const c = categoryOf ? categoryOf(tx.categoryId) : null;
      const key = c ? c.id : (tx.category || '?');
      const cur = map.get(key) || { name: c ? `${c.icon} ${c.name}` : (tx.category || 'Khác'), color: c ? c.color : null, value: 0 };
      cur.value += tx.amount;
      map.set(key, cur);
    }
    const entries = Array.from(map.values()).sort((a, b) => b.value - a.value);
    let labels = entries.map((e) => e.name);
    let values = entries.map((e) => e.value);
    const total = values.reduce((a, b) => a + b, 0);
    const empty = !values.length || total === 0;
    if (empty) { labels = [t('chart.noData')]; values = [1]; }
    const pal = palette(values.length);
    const colors = empty ? [dark ? '#3d2f2a' : '#e0d6d2'] : entries.map((e, i) => e.color || pal[i]);
    chart = new Chart(canvas, {
      type,
      data: { labels, datasets: [{ label: t('chart.byCategory'), data: values, backgroundColor: colors, borderColor: colors, fill: false, tension: .3 }] },
      options: { ...common, scales: axes, plugins: { ...common.plugins, tooltip: { enabled: !empty, callbacks: { label: (c) => ` ${c.label}: ${formatVND(c.parsed.y ?? c.parsed)}` } } } },
    });
    scopeText = t('chart.scopeExpense', { scope: scopeMonth });
    aria = empty ? t('chart.ariaEmpty', { scope: scopeMonth }) : t('chart.ariaCat', { scope: scopeMonth, total: formatVND(total) }) + entries.map((e) => `${e.name} ${formatVND(e.value)} (${Math.round(e.value / total * 100)}%)`).join('; ');
  }
  canvas.setAttribute('aria-label', aria);
  if (scopeEl) scopeEl.textContent = scopeText;
}

/** Heatmap chi theo ngày trong tháng (lưới DOM, không cần Chart.js) */
function renderHeatmap(holder, m, key) {
  if (!holder) return { max: 0, maxDay: null };
  const [y, mo] = key.split('-').map(Number);
  const days = new Date(y, mo, 0).getDate();
  const daily = new Array(days).fill(0);
  for (const tx of (m ? m.items : [])) { if (tx.type !== 'expense') continue; const d = Number(tx.date.slice(8, 10)) - 1; if (d >= 0 && d < days) daily[d] += tx.amount; }
  let max = 0, maxDay = null;
  daily.forEach((v, i) => { if (v > max) { max = v; maxDay = `${key}-${String(i + 1).padStart(2, '0')}`; } });
  const wd = t('chart.weekdays').split(',');
  const grid = el('div', { className: 'hm-grid', attrs: { role: 'grid' } });
  for (const w of wd) grid.appendChild(el('div', { className: 'hm-wd', text: w }));
  const first = new Date(y, mo - 1, 1).getDay(); // 0=CN
  const offset = (first + 6) % 7; // T2 đầu tuần
  for (let i = 0; i < offset; i++) grid.appendChild(el('div', { className: 'hm-cell empty' }));
  for (let d = 0; d < days; d++) {
    const v = daily[d];
    const lvl = !v ? 0 : max ? Math.min(4, 1 + Math.floor((v / max) * 3.999)) : 1;
    const date = `${key}-${String(d + 1).padStart(2, '0')}`;
    grid.appendChild(el('div', { className: `hm-cell l${lvl}`, attrs: { role: 'gridcell', title: `${dateLabel(date)}: ${formatVND(v)}`, 'aria-label': `${dateLabel(date)}: ${formatVND(v)}`, tabindex: v > 0 ? '0' : '-1' } }, [el('span', { className: 'hm-day', text: String(d + 1) })]));
  }
  holder.appendChild(grid);
  holder.appendChild(el('div', { className: 'hm-legend' }, [el('span', { text: '0' }), ...[1, 2, 3, 4].map((l) => el('span', { className: `hm-cell l${l}` })), el('span', { text: formatVND(max) })]));
  return { max, maxDay };
}

function compact(v) {
  const n = Number(v);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'k';
  return String(n);
}
