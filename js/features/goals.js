// Mục tiêu tiết kiệm (sinking funds) — thuần túy.
// goal: { id, name, icon, target, deadline: 'YYYY-MM-DD'|null, contributions: [{ id, date, amount, note }], createdAt, doneAt? }
import { uuid } from '../utils/id.js';
import { isValidYMD } from '../utils/date.js';

export function makeGoal(p = {}) {
  return {
    id: p.id || uuid(),
    name: String(p.name || '').trim() || 'Mục tiêu',
    icon: p.icon || '🎯',
    target: Math.max(0, Math.round(Number(p.target) || 0)),
    deadline: isValidYMD(p.deadline) ? p.deadline : null,
    contributions: Array.isArray(p.contributions) ? p.contributions.filter((c) => c && Number(c.amount)).map((c) => ({ id: c.id || uuid(), date: isValidYMD(c.date) ? c.date : null, amount: Math.round(Number(c.amount) || 0), note: String(c.note || '').trim() })) : [],
    createdAt: p.createdAt || Date.now(),
    doneAt: Number(p.doneAt) || null,
  };
}

/** Số tháng (làm tròn lên, tối thiểu 1) từ todayYMD tới deadline; null nếu không có hạn hoặc đã qua */
export function monthsUntil(deadline, todayYMD) {
  if (!deadline) return null;
  const [y1, m1, d1] = todayYMD.split('-').map(Number);
  const [y2, m2, d2] = deadline.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1);
  if (d2 > d1) months += 1; // chưa tới ngày trong tháng cuối → tính thêm 1 kỳ
  return months <= 0 ? 0 : months;
}

export function goalStatus(goal, todayYMD) {
  const saved = goal.contributions.reduce((a, c) => a + c.amount, 0);
  const remaining = Math.max(0, goal.target - saved);
  const pct = goal.target > 0 ? Math.min(1, saved / goal.target) : 0;
  const months = monthsUntil(goal.deadline, todayYMD);
  const perMonth = months === null ? null : months === 0 ? remaining : remaining / months;
  const overdue = goal.deadline ? goal.deadline < todayYMD && remaining > 0 : false;
  return { saved, remaining, pct, monthsLeft: months, perMonth, done: remaining === 0 && goal.target > 0, overdue };
}
