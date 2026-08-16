// Tiền tệ VND: định dạng & parser hiểu gõ tắt (sửa lỗi #8: '50k' → 50 đ, '1tr5' → 15 đ)
//
// parseAmount() hiểu:
//   '1250000', '1.250.000', '1,250,000', '1 250 000'   → 1_250_000
//   '50k', '50K', '50 nghìn', '50 ngàn', '50n'          → 50_000
//   '1tr', '1 triệu', '1trieu', '1m', '1M'              → 1_000_000
//   '1tr5', '1tr2', '1.5tr', '1,5tr', '1.5m'            → 1_500_000 / 1_200_000 / ...
//   '1tr250', '1tr250k', '1tr 250k'                     → 1_250_000
//   '2tỷ', '2 tỉ', '2b', '1tỷ5'                          → 2_000_000_000 / 1_500_000_000
//   '1.250.000đ', '1.250.000 vnd', '1.250.000 d'        → 1_250_000
// Trả về { value: number|null, ok: boolean, text: string(giải thích), raw }
// value = null nếu không hiểu được (không âm thầm ra số sai nữa).

const UNIT_MULT = [
  // thứ tự quan trọng: chuỗi dài trước để không match nhầm ('triệu' trước 'tr', 'nghìn' trước 'n')
  { re: /^(tỷ|tỉ|ty|ti|b)/i, mult: 1_000_000_000, name: 'tỷ' },
  { re: /^(triệu|trieu|tr|m)/i, mult: 1_000_000, name: 'triệu' },
  { re: /^(nghìn|nghin|ngàn|ngan|ng|k|n)/i, mult: 1_000, name: 'nghìn' },
];

export function formatVND(n, { withUnit = true } = {}) {
  const num = Math.round(Number(n) || 0);
  const s = Math.abs(num).toLocaleString('vi-VN');
  return (num < 0 ? '-' : '') + s + (withUnit ? ' đ' : '');
}

/** Chèn dấu chấm phân cách nghìn cho chuỗi số thuần (dùng khi gõ) */
export function groupDigits(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (!d) return '';
  return Number(d).toLocaleString('vi-VN');
}

/** Chuỗi có chứa ký tự đơn vị viết tắt hay không (k, tr, m, tỷ ...) */
export function hasUnitShorthand(s) {
  return /[a-zA-ZđĐỷỉệ]/.test(String(s || '').replace(/(đ|vnd|vnđ|d)\s*$/i, ''));
}

/**
 * @param {string|number} input
 * @returns {{ value: number|null, ok: boolean, text: string, raw: string }}
 */
export function parseAmount(input) {
  const raw = String(input ?? '');
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // bỏ ký hiệu tiền tệ ở cuối: đ, d, vnd, vnđ, ₫
    .replace(/\s*(vnđ|vnd|đ|₫|d)\s*$/i, '')
    .trim();

  if (!s) return { value: null, ok: false, text: '', raw };

  // Không có chữ (đơn vị) → coi là số thuần với dấu phân cách nghìn
  if (!/[a-zđỷỉệ]/i.test(s)) {
    const digits = s.replace(/[^\d]/g, '');
    if (!digits) return { value: null, ok: false, text: 'Không hiểu số tiền', raw };
    const value = Number(digits);
    if (!Number.isFinite(value) || value > 1e15) return { value: null, ok: false, text: 'Số quá lớn', raw };
    return { value, ok: value > 0, text: formatVND(value), raw };
  }

  // Có đơn vị: tách thành các đoạn [số][đơn vị], cộng dồn. VD '1tr250k' = 1tr + 250k
  let rest = s.replace(/ /g, '');
  let total = 0;
  let segments = 0;
  let lastMult = Infinity;
  let guard = 0;
  while (rest.length && guard++ < 10) {
    const m = rest.match(/^(\d+(?:[.,]\d+)?)/);
    if (!m) return { value: null, ok: false, text: 'Không hiểu số tiền', raw };
    const numStr = m[1].replace(',', '.');
    let num = Number(numStr);
    rest = rest.slice(m[1].length);

    let unit = null;
    for (const u of UNIT_MULT) {
      const um = rest.match(u.re);
      if (um) {
        unit = u;
        rest = rest.slice(um[0].length);
        break;
      }
    }

    if (unit) {
      // '1.250tr' → 1.25 triệu (dấu chấm là thập phân khi đi kèm đơn vị)
      if (unit.mult >= lastMult) {
        // đơn vị không giảm dần (VD '5k1tr') → không hiểu
        return { value: null, ok: false, text: 'Không hiểu số tiền', raw };
      }
      total += num * unit.mult;
      lastMult = unit.mult;
      segments++;
    } else {
      // Không có đơn vị sau số: nếu đứng sau một đơn vị lớn hơn thì là phần lẻ ('1tr5' → 1tr + 0.5tr; '1tr250' → 1tr + 0.250tr)
      if (segments > 0 && lastMult > 1 && /^\d+$/.test(m[1])) {
        const frac = Number('0.' + m[1]);
        total += frac * lastMult;
        lastMult = 1;
        segments++;
      } else if (segments === 0 && rest.length === 0) {
        // chỉ là số thuần (đã xử lý ở trên, phòng hờ)
        total += num;
        segments++;
      } else {
        return { value: null, ok: false, text: 'Không hiểu số tiền', raw };
      }
    }
  }
  if (rest.length) return { value: null, ok: false, text: 'Không hiểu số tiền', raw };
  const value = Math.round(total);
  if (!Number.isFinite(value) || value > 1e15) return { value: null, ok: false, text: 'Số quá lớn', raw };
  return { value, ok: value > 0, text: formatVND(value), raw };
}
