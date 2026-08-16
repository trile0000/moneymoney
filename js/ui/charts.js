// Biểu đồ (Chart.js self-host, sửa lỗi #13/#17). Nhận dữ liệu từ chỉ mục — không load() lại (sửa lỗi #20).
// Ghi rõ phạm vi dữ liệu từng biểu đồ (sửa lỗi #27) + mô tả text cho trình đọc màn hình (sửa lỗi #26).
import { formatVND } from '../utils/money.js';
import { monthLabel } from '../utils/date.js';

let chart = null;

function palette(n) {
  const base = ['#b3261e', '#2e7d32', '#7A2A1A', '#8B2E1A', '#ff8f00', '#1565c0', '#6a1b9a', '#00897b', '#c2185b', '#455a64', '#ef6c00', '#5d4037', '#8e24aa', '#43a047', '#1e88e5'];
  return Array.from({ length: n }, (_, i) => base[i % base.length]);
}

const TREND_MONTHS = 12;

/**
 * @param {object} p
 * @param {HTMLCanvasElement} p.canvas
 * @param {HTMLElement} p.scopeEl
 * @param {'byCategory'|'totals'|'trend'} p.mode
 * @param {'doughnut'|'bar'|'line'} p.type
 * @param {string} p.monthKey  'YYYY-MM' đang lọc ('' = tất cả)
 * @param {{income:number, expense:number, items:Array}} p.month
 * @param {Map} p.monthIndex
 */
export function renderChart({ canvas, scopeEl, mode, type, monthKey, month, monthIndex }) {
  if (!canvas || typeof window.Chart === 'undefined') {
    if (scopeEl) scopeEl.textContent = 'Không tải được thư viện biểu đồ.';
    return;
  }
  if (chart) { try { chart.destroy(); } catch { /* ignore */ } chart = null; }
  const scopeMonth = monthKey ? monthLabel(monthKey) : 'tất cả thời gian';
  let scopeText = '';
  let aria = '';
  const common = { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: type === 'doughnut' ? 'bottom' : 'top' } } };
  const axes = type === 'line' || type === 'bar' ? { y: { beginAtZero: true, ticks: { callback: (v) => compact(v) } } } : undefined;

  if (mode === 'trend') {
    const months = Array.from(monthIndex.keys()).sort();
    const shown = months.slice(-TREND_MONTHS);
    const labels = shown.map(monthLabel);
    const inc = shown.map((m) => monthIndex.get(m).income);
    const exp = shown.map((m) => monthIndex.get(m).expense);
    const t = type === 'doughnut' ? 'bar' : type; // donut không có nghĩa cho chuỗi thời gian
    chart = new Chart(canvas, {
      type: t,
      data: { labels, datasets: [
        { label: 'Thu nhập', data: inc, borderColor: '#2e7d32', backgroundColor: t === 'bar' ? '#2e7d32' : 'rgba(46,125,50,.15)', tension: .3, fill: false },
        { label: 'Chi tiêu', data: exp, borderColor: '#b3261e', backgroundColor: t === 'bar' ? '#b3261e' : 'rgba(179,38,30,.15)', tension: .3, fill: false },
      ] },
      options: { ...common, scales: { y: { beginAtZero: true, ticks: { callback: (v) => compact(v) } } } },
    });
    scopeText = `Phạm vi: toàn bộ lịch sử, ${shown.length} tháng gần nhất (không theo bộ lọc tháng)`;
    aria = `Biểu đồ biến động thu chi ${shown.length} tháng gần nhất. ` + shown.map((m, i) => `${monthLabel(m)}: thu ${formatVND(inc[i])}, chi ${formatVND(exp[i])}`).join('; ');
  } else if (mode === 'totals') {
    const values = [month.income, month.expense];
    const colors = ['#2e7d32', '#b3261e'];
    chart = new Chart(canvas, {
      type,
      data: { labels: ['Thu', 'Chi'], datasets: [{ label: 'Tổng hợp thu/chi', data: values, backgroundColor: colors, borderColor: colors, fill: false, tension: .3 }] },
      options: { ...common, scales: axes },
    });
    scopeText = `Phạm vi: ${scopeMonth}`;
    aria = `Biểu đồ tổng thu và chi ${scopeMonth}: thu ${formatVND(month.income)}, chi ${formatVND(month.expense)}.`;
  } else {
    const map = new Map();
    for (const t of month.items) { if (t.type !== 'expense') continue; map.set(t.category, (map.get(t.category) || 0) + t.amount); }
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    let labels = entries.map((e) => e[0]);
    let values = entries.map((e) => e[1]);
    const total = values.reduce((a, b) => a + b, 0);
    const empty = !values.length || total === 0;
    if (empty) { labels = ['Không có dữ liệu']; values = [1]; }
    const colors = empty ? ['#e0d6d2'] : palette(values.length);
    chart = new Chart(canvas, {
      type,
      data: { labels, datasets: [{ label: 'Chi tiêu theo danh mục', data: values, backgroundColor: colors, borderColor: colors, fill: false, tension: .3 }] },
      options: { ...common, scales: axes, plugins: { ...common.plugins, tooltip: { enabled: !empty, callbacks: { label: (c) => ` ${c.label}: ${formatVND(c.parsed.y ?? c.parsed)}` } } } },
    });
    scopeText = `Phạm vi: chi tiêu ${scopeMonth}`;
    aria = empty ? `Không có chi tiêu ${scopeMonth}.` : `Chi tiêu theo danh mục ${scopeMonth}, tổng ${formatVND(total)}: ` + entries.map(([k, v]) => `${k} ${formatVND(v)} (${Math.round(v / total * 100)}%)`).join('; ');
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
