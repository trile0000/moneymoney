// Tài sản ròng — thuần túy.
// asset: { id, name, type, value, liability: bool, updatedAt, note }
import { uuid } from '../utils/id.js';

export const ASSET_TYPES = ['savings', 'stock', 'fund', 'gold', 'realestate', 'vehicle', 'crypto', 'other'];
export const ASSET_ICONS = { savings: '🏦', stock: '📈', fund: '📊', gold: '🪙', realestate: '🏠', vehicle: '🚗', crypto: '🪙', other: '📦', cash: '💵' };

export function makeAsset(p = {}) {
  return {
    id: p.id || uuid(),
    name: String(p.name || '').trim() || 'Tài sản',
    type: ASSET_TYPES.includes(p.type) ? p.type : 'other',
    value: Math.max(0, Math.round(Number(p.value) || 0)),
    liability: !!p.liability,
    updatedAt: Number(p.updatedAt) || Date.now(),
    note: String(p.note || '').trim(),
  };
}

/**
 * Tổng hợp tài sản ròng.
 * @param {object} p
 * @param {Array} p.accounts  ví (không lưu trữ)
 * @param {Map} p.balances    số dư ví
 * @param {Array} p.assets    tài sản/nợ khai báo
 * @param {Array} p.debtBalances  [{ name, balance }] dư nợ các khoản vay
 * @param {object} [p.iou]  { receivable, payable } công nợ cá nhân
 */
export function computeNetWorth({ accounts, balances, assets = [], debtBalances = [], iou = null }) {
  const items = [];
  let assetsTotal = 0, liabilitiesTotal = 0;
  const byType = new Map();
  const add = (type, v) => byType.set(type, (byType.get(type) || 0) + v);
  for (const a of accounts) {
    if (a.archived) continue;
    const b = balances.get(a.id) || 0;
    if (b >= 0) { assetsTotal += b; add(a.type === 'credit' ? 'cash' : a.type, b); items.push({ kind: 'account', name: a.name, value: b, type: a.type }); }
    else { liabilitiesTotal += -b; items.push({ kind: 'account', name: a.name, value: b, type: a.type }); }
  }
  for (const s of assets) {
    if (s.liability) { liabilitiesTotal += s.value; items.push({ kind: 'liability', name: s.name, value: -s.value, type: s.type }); }
    else { assetsTotal += s.value; add(s.type, s.value); items.push({ kind: 'asset', name: s.name, value: s.value, type: s.type }); }
  }
  for (const d of debtBalances) { if (d.balance > 0) { liabilitiesTotal += d.balance; items.push({ kind: 'debt', name: d.name, value: -d.balance, type: 'debt' }); } }
  // Công nợ cá nhân: người khác nợ tôi = tài sản (phải thu); tôi nợ người khác = nợ (phải trả)
  if (iou) {
    if (iou.receivable > 0) { assetsTotal += iou.receivable; add('receivable', iou.receivable); items.push({ kind: 'iou', name: iou.receivableLabel || 'Cho mượn', value: iou.receivable, type: 'receivable' }); }
    if (iou.payable > 0) { liabilitiesTotal += iou.payable; items.push({ kind: 'iou', name: iou.payableLabel || 'Đi mượn', value: -iou.payable, type: 'payable' }); }
  }
  return { assets: assetsTotal, liabilities: liabilitiesTotal, net: assetsTotal - liabilitiesTotal, items, byType };
}

/** Cập nhật snapshot tháng (upsert theo ym) — trả về mảng mới đã sort */
export function upsertSnapshot(snapshots, ym, { assets, liabilities }) {
  const list = (snapshots || []).filter((s) => s.ym !== ym);
  list.push({ ym, assets: Math.round(assets), liabilities: Math.round(liabilities), net: Math.round(assets - liabilities) });
  return list.sort((a, b) => a.ym.localeCompare(b.ym)).slice(-60);
}

/** Điểm đa dạng hóa 0..1 dựa trên số lớp tài sản có giá trị > 0 (không tính tiền mặt/ngân hàng như một lớp riêng ngoài "cash") */
export function diversification(byType) {
  const classes = new Set();
  for (const [type, v] of byType) {
    if (v <= 0) continue;
    if (type === 'cash' || type === 'bank' || type === 'ewallet') classes.add('cash');
    else if (type === 'receivable') continue;
    else classes.add(type);
  }
  return { count: classes.size, score: Math.min(1, classes.size / 4), classes: [...classes] };
}
