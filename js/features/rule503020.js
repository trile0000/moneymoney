// Quy tắc 50/30/20 (Thiết yếu / Mong muốn / Tiết kiệm–Đầu tư) — thuần túy.
import { effectiveGroup } from './categories.js';

export const GROUPS = ['need', 'want', 'save'];

/**
 * @param {Array} items giao dịch của tháng (mọi loại)
 * @param {Array} categories toàn bộ danh mục
 * @param {{need,want,save}} weights  tỉ trọng mục tiêu (tổng ~100)
 * @returns {{ income, spend: {need,want,save,unassigned}, ratios: {need,want,save,unassigned}, target: {...}, unassignedCategoryIds: string[] }}
 */
export function compute503020(items, categories, weights = { need: 50, want: 30, save: 20 }) {
  const cache = new Map();
  const groupOf = (id) => { if (!cache.has(id)) cache.set(id, effectiveGroup(categories, id)); return cache.get(id); };
  const spend = { need: 0, want: 0, save: 0, unassigned: 0 };
  const unassigned = new Set();
  let income = 0;
  for (const t of items) {
    if (t.deletedAt) continue;
    if (t.type === 'income') { income += t.amount; continue; }
    if (t.type !== 'expense') continue;
    const g = groupOf(t.categoryId);
    if (g) spend[g] += t.amount; else { spend.unassigned += t.amount; if (t.categoryId) unassigned.add(t.categoryId); }
  }
  const base = income > 0 ? income : (spend.need + spend.want + spend.save + spend.unassigned) || 1;
  const ratios = { need: spend.need / base, want: spend.want / base, save: spend.save / base, unassigned: spend.unassigned / base };
  // phần thu nhập chưa chi cũng coi là "tiết kiệm" (không tiêu) — hiển thị riêng
  const totalSpent = spend.need + spend.want + spend.save + spend.unassigned;
  const leftover = income > 0 ? Math.max(0, income - totalSpent) : 0;
  const w = { need: Number(weights.need) || 0, want: Number(weights.want) || 0, save: Number(weights.save) || 0 };
  const sum = w.need + w.want + w.save || 100;
  const target = { need: w.need / sum, want: w.want / sum, save: w.save / sum };
  return { income, spend, ratios, target, leftover, leftoverRatio: income > 0 ? leftover / income : 0, unassignedCategoryIds: [...unassigned], baseIsIncome: income > 0 };
}
