// Migration schema dữ liệu — thuần túy (không đụng localStorage) để test được.
//
// v1 (mm_transactions_v1): mảng [{ id, type, amount, category, note, createdAt }]
// v2 (mm_data_v2): { schemaVersion: 2, transactions, meta, savedAt } — date local, source/periodKey, uuid
// v3 (mm_data_v3): + accounts, categories (2 cấp), recurring (tổng quát), tags, transfer, và các slice P1b/P1c (budgets, goals, debts, assets, snapshots)
//    giao dịch: { id, type: 'income'|'expense'|'transfer', amount, category (tên), categoryId, accountId, toAccountId?, note, tags[],
//                date, createdAt, updatedAt?, source: 'manual'|'recurring'|'import'|'auto-salary', recurringId?, periodKey?, receiptId?, debt? { kind lend|borrow|repay, person, refId? }, deletedAt? }

import { uuid } from './utils/id.js';
import { toLocalYMD, ymOf, isValidYMD, isValidYM } from './utils/date.js';
import { defaultCategoryList, findOrCreate, makeCategory, normName } from './features/categories.js';
import { defaultAccountList, makeAccount } from './features/accounts.js';
import { makeRule } from './features/recurring.js';
import { makeBudget } from './features/budgets.js';
import { makeGoal } from './features/goals.js';
import { makeDebt } from './features/debts.js';
import { makeAsset } from './features/networth.js';

export const SCHEMA_VERSION = 3;
export const LEGACY_SALARY_NOTE = 'Tự động thêm từ hệ thống';

export function emptyData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    transactions: [],
    accounts: [],
    categories: [],
    recurring: [],
    budgets: [],
    goals: [],
    debts: [],
    assets: [],
    snapshots: { networth: [] },
    meta: {},
    savedAt: 0,
  };
}

/** Chuẩn hóa 1 giao dịch (dùng cho migrate và import). Trả null nếu không cứu được. */
export function normalizeTransaction(t, { seenIds, now = Date.now(), defaultSource = 'manual' } = {}) {
  if (!t || typeof t !== 'object') return null;
  const type = t.type === 'income' ? 'income' : t.type === 'transfer' ? 'transfer' : 'expense';
  const amount = Math.abs(Math.round(Number(t.amount) || 0));
  const category = String(t.category ?? '').trim() || (type === 'transfer' ? '' : 'Khác');
  const note = String(t.note ?? '').trim();

  let date = typeof t.date === 'string' && isValidYMD(t.date) ? t.date : null;
  let createdAt = Number(t.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) createdAt = now;
  if (!date) date = toLocalYMD(createdAt);

  let id = typeof t.id === 'string' || typeof t.id === 'number' ? String(t.id) : '';
  if (!id || (seenIds && seenIds.has(id))) id = uuid();
  if (seenIds) seenIds.add(id);

  let source = t.source;
  let periodKey = t.periodKey;
  if (!source) {
    if (type === 'income' && note === LEGACY_SALARY_NOTE) { source = 'auto-salary'; periodKey = periodKey || ymOf(date); }
    else source = defaultSource;
  }
  if (source === 'auto-salary' && !periodKey) periodKey = ymOf(date);

  const out = { id, type, amount, category, note, date, createdAt, source };
  if (t.categoryId) out.categoryId = String(t.categoryId);
  if (t.accountId) out.accountId = String(t.accountId);
  if (type === 'transfer' && t.toAccountId) out.toAccountId = String(t.toAccountId);
  out.tags = Array.isArray(t.tags) ? Array.from(new Set(t.tags.map((x) => String(x).trim()).filter(Boolean))).slice(0, 20) : [];
  if (periodKey) out.periodKey = periodKey;
  if (t.recurringId) out.recurringId = String(t.recurringId);
  if (t.receiptId) out.receiptId = String(t.receiptId);
  if (t.debt && typeof t.debt === 'object' && ['lend', 'borrow', 'repay'].includes(t.debt.kind)) {
    out.debt = { kind: t.debt.kind, person: String(t.debt.person || '').trim(), settledAt: Number(t.debt.settledAt) || null };
    if (t.debt.refId) out.debt.refId = String(t.debt.refId);
  }
  if (Number.isFinite(Number(t.updatedAt))) out.updatedAt = Number(t.updatedAt);
  if (Number.isFinite(Number(t.deletedAt)) && Number(t.deletedAt) > 0) out.deletedAt = Number(t.deletedAt);
  return out;
}

export function sortTx(arr) {
  return arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
}

/**
 * migrate(raw, { settings, now }) — nhận bất kỳ dữ liệu nào (v1 mảng, v2/v3 object, rác) → v3 hợp lệ + settings đã nâng cấp.
 * Không bao giờ ném lỗi; không bao giờ mất giao dịch có amount hợp lệ.
 * @returns {{ data, settings, fromVersion, changed, stats }}
 */
export function migrate(raw, { settings: settingsIn, now = Date.now() } = {}) {
  const settings = migrateSettings(settingsIn);
  const seen = new Set();
  const data = emptyData();
  let list = [];
  let fromVersion = 0;
  let src = null;

  if (Array.isArray(raw)) { list = raw; fromVersion = 1; }
  else if (raw && typeof raw === 'object' && Array.isArray(raw.transactions)) {
    list = raw.transactions;
    fromVersion = Number(raw.schemaVersion) || 2;
    src = raw;
    data.meta = raw.meta && typeof raw.meta === 'object' ? { ...raw.meta } : {};
    data.savedAt = Number(raw.savedAt) || 0;
  } else {
    fromVersion = 0;
  }

  let dupIdsFixed = 0, dropped = 0;
  for (const t of list) {
    const before = t && (typeof t.id === 'string' || typeof t.id === 'number') ? String(t.id) : '';
    const n = normalizeTransaction(t, { seenIds: seen, now });
    if (!n) { dropped++; continue; }
    if (before && n.id !== before) dupIdsFixed++;
    data.transactions.push(n);
  }

  // ---- slice v3 (giữ nếu đã có, tạo mặc định nếu chưa) ----
  data.accounts = (src && Array.isArray(src.accounts) && src.accounts.length ? src.accounts.map((a) => makeAccount(a)) : defaultAccountList());
  data.categories = (src && Array.isArray(src.categories) && src.categories.length ? src.categories.map((c) => makeCategory(c)) : defaultCategoryList());
  data.recurring = src && Array.isArray(src.recurring) ? src.recurring.map((r) => makeRule(r)) : [];
  data.budgets = src && Array.isArray(src.budgets) ? src.budgets.map((b) => makeBudget(b)) : [];
  data.goals = src && Array.isArray(src.goals) ? src.goals.map((g) => makeGoal(g)) : [];
  data.debts = src && Array.isArray(src.debts) ? src.debts.map((d) => makeDebt(d)) : [];
  data.assets = src && Array.isArray(src.assets) ? src.assets.map((a) => makeAsset(a)) : [];
  data.snapshots = src && src.snapshots && typeof src.snapshots === 'object' ? { networth: [], ...src.snapshots } : { networth: [] };

  const defaultAccount = data.accounts.find((a) => a.id === settings.defaultAccountId && !a.archived) || data.accounts.find((a) => !a.archived) || data.accounts[0];
  if (!settings.defaultAccountId || !data.accounts.some((a) => a.id === settings.defaultAccountId)) settings.defaultAccountId = defaultAccount.id;

  // ---- gán accountId / categoryId cho giao dịch chưa có (v1/v2 → v3) ----
  let catCreated = 0;
  const catIdSet = new Set(data.categories.map((c) => c.id));
  for (const t of data.transactions) {
    if (!t.accountId || !data.accounts.some((a) => a.id === t.accountId)) t.accountId = defaultAccount.id;
    if (t.type === 'transfer' && (!t.toAccountId || !data.accounts.some((a) => a.id === t.toAccountId))) {
      // chuyển khoản mất đích → coi là chi
      t.type = 'expense'; delete t.toAccountId; if (!t.category) t.category = 'Khác';
    }
    if (t.type !== 'transfer') {
      if (t.categoryId && catIdSet.has(t.categoryId)) {
        // đồng bộ tên hiển thị theo danh mục
        const c = data.categories.find((x) => x.id === t.categoryId);
        if (c && normName(c.name) !== normName(t.category)) t.category = c.name;
      } else {
        const kind = t.type === 'income' ? 'income' : 'expense';
        const { category, created } = findOrCreate(data.categories, t.category || 'Khác', { kind });
        if (created) { data.categories.push(category); catIdSet.add(category.id); catCreated++; }
        else if (category.kind !== 'both' && category.kind !== kind) { category.kind = 'both'; }
        t.categoryId = category.id;
        t.category = category.name;
      }
    } else {
      delete t.categoryId; t.category = '';
    }
  }

  // ---- lương cũ (P0) → rule định kỳ tổng quát ----
  let salaryRuleCreated = false;
  const hasSalaryRule = data.recurring.some((r) => r.legacySalary) || data.meta.salaryMigrated === true;
  if (!hasSalaryRule && (settings.salary > 0 || data.transactions.some((t) => t.source === 'auto-salary'))) {
    const { category: cat, created } = findOrCreate(data.categories, settings.salaryCategory || 'Lương', { kind: 'income' });
    if (created) { data.categories.push(cat); catCreated++; }
    const last = isValidYM(settings.lastSalaryPeriod) ? settings.lastSalaryPeriod : null;
    const startYM = last || toLocalYMD(now).slice(0, 7);
    const rule = makeRule({
      name: cat.name,
      enabled: settings.salary > 0,
      template: { type: 'income', amount: settings.salary, categoryId: cat.id, category: cat.name, accountId: defaultAccount.id, note: 'Lương tự động', tags: [] },
      freq: 'monthly', interval: 1, byMonthDay: 1,
      startDate: `${startYM}-01`,
      lastDate: last ? `${last}-01` : null,
      createdAt: now,
    });
    rule.legacySalary = true;
    data.recurring.push(rule);
    for (const t of data.transactions) if (t.source === 'auto-salary' && !t.recurringId) t.recurringId = rule.id;
    data.meta.salaryMigrated = true;
    salaryRuleCreated = true;
  }

  sortTx(data.transactions);
  const changed = fromVersion !== SCHEMA_VERSION || dupIdsFixed > 0 || dropped > 0 || catCreated > 0 || salaryRuleCreated;
  return { data, settings, fromVersion, changed, stats: { total: data.transactions.length, dupIdsFixed, dropped, catCreated, salaryRuleCreated } };
}

// ---------- Cài đặt ----------
export function defaultSettings() {
  return {
    schemaVersion: SCHEMA_VERSION,
    salary: 0,
    salaryCategory: 'Lương',
    salaryEnabled: null,
    thresholds: { t2: 5000000, t3: 10000000, t4: 20000000 },
    messages: {
      t0: '😿 Âm ({sign}{amount}). Thử cắt giảm vài khoản không cần thiết nhé!',
      t1: '🙂 Dư nhẹ ({sign}{amount}). Đặt thêm mục tiêu tiết kiệm nhé!',
      t2: '🤑 Dư dả ({sign}{amount})! Tiếp tục tiết kiệm thông minh!',
      t3: '🚀 Siêu khá ({sign}{amount})! Xịn quá, duy trì đà này!',
      t4: '👑 Đại gia ({sign}{amount})! Đặt mục tiêu đầu tư dài hạn nhé!',
    },
    bestTier: 0,
    bestTierMonth: null,
    lastSalaryPeriod: null,
    // v3
    theme: 'system', // 'system' | 'light' | 'dark'
    locale: 'vi', // 'vi' | 'en'
    defaultAccountId: null,
    lastCategoryId: null,
    lastAccountId: null,
    rule503020: { need: 50, want: 30, save: 20 },
    emergencyMonths: 6,
    emergencyAccountIds: [], // ví được tính vào quỹ khẩn cấp
    emergencyExtra: 0, // số tiền quỹ giữ ngoài app (sổ tiết kiệm…)
    savedFilters: [],
    cardOrder: [], // thứ tự thẻ trang chủ
    healthWeights: { savings: 25, emergency: 25, dti: 20, stability: 15, diversify: 15 },
    forecastMonths: 6,
    badges: [], // [{ key, at }]
    onboarded: false, // P1d: đã qua onboarding (hoặc là người dùng cũ)
    csvTemplates: [], // P1d-2: mẫu ánh xạ cột đã lưu [{ name, map{field: headerName}, dateFormat, autoCategory }]
    lock: { autoLockMin: 5 }, // P1d-2: tự khóa (phút) khi đang bật mã hóa
    invest: { answers: {}, score: null, profile: null, monthly: null, years: 10, returns: null, acceptedAt: null }, // P2 Module C
  };
}

export function migrateSettings(raw) {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const out = {
    ...d,
    ...raw,
    thresholds: { ...d.thresholds, ...(raw.thresholds || {}) },
    messages: { ...d.messages, ...(raw.messages || {}) },
    rule503020: { ...d.rule503020, ...(raw.rule503020 || {}) },
    healthWeights: { ...d.healthWeights, ...(raw.healthWeights || {}) },
    schemaVersion: SCHEMA_VERSION,
  };
  out.salary = Math.max(0, Number(out.salary) || 0);
  out.salaryCategory = String(out.salaryCategory || 'Lương').trim() || 'Lương';
  out.bestTier = Math.max(0, Math.min(4, Number(out.bestTier) || 0));
  const th = out.thresholds;
  th.t2 = Math.max(0, Number(th.t2) || 0);
  th.t3 = Math.max(th.t2, Number(th.t3) || 0);
  th.t4 = Math.max(th.t3, Number(th.t4) || 0);
  if (!['system', 'light', 'dark'].includes(out.theme)) out.theme = 'system';
  if (!['vi', 'en'].includes(out.locale)) out.locale = 'vi';
  if (!Array.isArray(out.savedFilters)) out.savedFilters = [];
  if (!Array.isArray(out.emergencyAccountIds)) out.emergencyAccountIds = [];
  if (!Array.isArray(out.cardOrder)) out.cardOrder = [];
  out.emergencyExtra = Math.max(0, Number(out.emergencyExtra) || 0);
  if (!Array.isArray(out.badges)) out.badges = [];
  if (!Array.isArray(out.csvTemplates)) out.csvTemplates = [];
  out.lock = { ...d.lock, ...(out.lock && typeof out.lock === 'object' ? out.lock : {}) };
  out.invest = { ...d.invest, ...(out.invest && typeof out.invest === 'object' ? out.invest : {}) };
  if (!out.invest.answers || typeof out.invest.answers !== 'object') out.invest.answers = {};
  out.forecastMonths = [3, 6, 12].includes(Number(out.forecastMonths)) ? Number(out.forecastMonths) : 6;
  out.emergencyMonths = [3, 6, 12].includes(Number(out.emergencyMonths)) ? Number(out.emergencyMonths) : 6;
  return out;
}
