// ID duy nhất cho giao dịch (sửa lỗi #1: Date.now() trùng trong cùng mili-giây)
// Ưu tiên crypto.randomUUID(); fallback dùng getRandomValues; fallback cuối là Math.random
// (chỉ xảy ra trên trình duyệt rất cũ, không có crypto).

export function uuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  // Fallback cuối cùng
  return 'x' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) + '-' + Math.random().toString(36).slice(2, 8);
}
