// Ô nhập số tiền: tự chèn dấu chấm khi gõ số thuần, hiểu gõ tắt và HIỂN THỊ số đã hiểu để xác nhận (sửa lỗi #8)
import { parseAmount, groupDigits, formatVND } from '../utils/money.js';

export function bindAmountInput(input, hintEl) {
  function update() {
    const raw = input.value;
    // Chỉ số + dấu phân cách → tự format nhóm nghìn, giữ caret ở cuối
    if (/^[\d.,\s]*$/.test(raw)) {
      const g = groupDigits(raw);
      if (g !== raw) input.value = g;
    }
    const p = parseAmount(input.value);
    if (!input.value.trim()) { hintEl.textContent = ''; hintEl.className = 'hint'; input.removeAttribute('aria-invalid'); return; }
    if (p.value === null) { hintEl.textContent = '⚠️ ' + (p.text || 'Không hiểu số tiền'); hintEl.className = 'hint err'; input.setAttribute('aria-invalid', 'true'); return; }
    if (p.value <= 0) { hintEl.textContent = '⚠️ Số tiền phải lớn hơn 0'; hintEl.className = 'hint err'; input.setAttribute('aria-invalid', 'true'); return; }
    hintEl.textContent = '= ' + formatVND(p.value);
    hintEl.className = 'hint ok';
    input.removeAttribute('aria-invalid');
  }
  input.addEventListener('input', update);
  input.addEventListener('blur', () => {
    const p = parseAmount(input.value);
    if (p.value !== null && p.value > 0) { input.value = formatVND(p.value, { withUnit: false }); update(); }
  });
  return {
    getValue() { const p = parseAmount(input.value); return p.value; },
    setValue(n) { input.value = n ? formatVND(n, { withUnit: false }) : ''; update(); },
    refresh: update,
    clear() { input.value = ''; update(); },
  };
}
