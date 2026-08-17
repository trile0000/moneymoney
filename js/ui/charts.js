// Biểu đồ (Chart.js self-host). Nhận dữ liệu từ chỉ mục — không load() lại (lỗi #20).
// Ghi rõ phạm vi dữ liệu (lỗi #27) + mô tả text cho trình đọc màn hình (lỗi #26). Chuyển khoản không tính vào thu/chi.
import { formatVND } from '../utils/money.js';
import { t, monthLabelL } from '../i18n.js';
import { isDark } from './theme.js';

let chart = null;

function palette(n) {
  const base = ['#b3261e', '#2e7d32', '#7A2A1A', '#ef6c00', '#1565c0', '#6a1b9a', '#00897b', '#c2185b', '#455a64', '#8e24aa', '#43a047', '#1e88e5', '#5d4037', '#f9a825', '#00acc1'];
  return Array.from({ length: n }, (_, i) => base[i % base.length]);
}
const TREND_MONTHS = 12;

export function renderChart({ canvas, scopeEl, mode, type, monthKey, month, monthIndex, categoryOf }) {
  if (!canvas || typeof window.Chart === 'undefined') {
    if (scopeEl) scopeEl.textContent = t('chart.libFail');
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

function compact(v) {
  const n = Number(v);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'k';
  return String(n);
}
