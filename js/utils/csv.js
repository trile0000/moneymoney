// CSV đúng chuẩn RFC 4180 (sửa lỗi #25: thay dấu phẩy bằng khoảng trắng, thiếu BOM UTF-8)

const BOM = '\uFEFF';

export function csvEscapeCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Cần bọc ngoặc kép nếu có dấu phẩy, ngoặc kép, xuống dòng hoặc khoảng trắng đầu/cuối
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** rows: mảng các mảng → chuỗi CSV có BOM để Excel tiếng Việt nhận UTF-8 */
export function toCSV(rows, { bom = true, eol = '\r\n' } = {}) {
  const body = rows.map((r) => r.map(csvEscapeCell).join(',')).join(eol);
  return (bom ? BOM : '') + body + eol;
}

/**
 * Parse CSV → mảng các mảng chuỗi. Hỗ trợ ngoặc kép, "" escape, xuống dòng trong ô,
 * dấu phân cách , hoặc ; (tự dò theo dòng đầu), CRLF/LF, BOM.
 */
export function parseCSV(text, { delimiter } = {}) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (!s.trim()) return [];

  const delim = delimiter || detectDelimiter(s);
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // dòng cuối không có newline
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // bỏ các dòng hoàn toàn trống
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function detectDelimiter(s) {
  const firstLine = s.split(/\r?\n/, 1)[0] || '';
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  if (tabs > commas && tabs > semis) return '\t';
  return semis > commas ? ';' : ',';
}
