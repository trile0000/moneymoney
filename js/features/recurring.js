// Lương định kỳ theo "kỳ còn thiếu" (sửa lỗi #6, #7).
// - Không phụ thuộc việc mở app đúng mùng 1: mọi kỳ từ lần kiểm tra cuối đến tháng hiện tại đều được bù.
// - Nhận diện bằng cờ source='auto-salary' + periodKey='YYYY-MM', không dò chuỗi 'lương'.
// - Nếu tháng đó đã có khoản thu thủ công đúng danh mục lương → coi là đã có, không thêm trùng.
// - Thuần túy: không đụng state/storage → test được.

import { addMonths, monthRange, ymOf, isValidYM, monthLabel } from '../utils/date.js';

export const AUTO_SALARY_SOURCE = 'auto-salary';

/**
 * @param {object} p
 * @param {object} p.settings   { salary, salaryCategory, salaryEnabled, lastSalaryPeriod }
 * @param {Array}  p.transactions  toàn bộ giao dịch (kể cả đã xóa mềm — để tôn trọng việc người dùng đã xóa)
 * @param {string} p.todayYM    'YYYY-MM' hiện tại (giờ địa phương)
 * @returns {{ toAdd: Array, lastSalaryPeriod: string|null, checked: string[] }}
 */
export function computeSalaryBackfill({ settings, transactions, todayYM }) {
  const salary = Math.max(0, Number(settings?.salary) || 0);
  const enabled = settings?.salaryEnabled === null || settings?.salaryEnabled === undefined ? salary > 0 : !!settings.salaryEnabled;
  if (!enabled || salary <= 0 || !isValidYM(todayYM)) {
    return { toAdd: [], lastSalaryPeriod: settings?.lastSalaryPeriod ?? null, checked: [] };
  }
  const category = String(settings.salaryCategory || 'Lương').trim() || 'Lương';
  const catLower = category.toLowerCase();

  // Kỳ đã có lương tự động (kể cả đã xóa) và kỳ có khoản thu thủ công đúng danh mục lương
  const autoPeriods = new Set();
  const manualSalaryPeriods = new Set();
  for (const t of transactions || []) {
    if (t.type !== 'income') continue;
    const pk = t.periodKey || ymOf(t.date);
    if (t.source === AUTO_SALARY_SOURCE) autoPeriods.add(pk);
    else if (!t.deletedAt && String(t.category || '').trim().toLowerCase() === catLower) manualSalaryPeriods.add(pk);
  }

  // Xác định kỳ bắt đầu
  let startYM;
  const last = settings.lastSalaryPeriod;
  if (isValidYM(last)) {
    startYM = addMonths(last, 1);
  } else {
    // Lần đầu chạy cơ chế mới: bắt đầu từ kỳ lương tự động sớm nhất đã có (dữ liệu cũ), nếu không có thì tháng hiện tại
    const earliest = Array.from(autoPeriods).filter(isValidYM).sort()[0];
    startYM = earliest && earliest < todayYM ? earliest : todayYM;
  }
  if (startYM > todayYM) {
    return { toAdd: [], lastSalaryPeriod: last ?? null, checked: [] };
  }

  const periods = monthRange(startYM, todayYM);
  const toAdd = [];
  for (const pk of periods) {
    if (autoPeriods.has(pk) || manualSalaryPeriods.has(pk)) continue;
    toAdd.push({
      type: 'income',
      amount: salary,
      category,
      note: `Lương tự động (kỳ ${monthLabel(pk)})`,
      date: `${pk}-01`,
      source: AUTO_SALARY_SOURCE,
      periodKey: pk,
    });
  }
  return { toAdd, lastSalaryPeriod: todayYM, checked: periods };
}
