# P1 — Kế hoạch Module A (Dòng tiền) + Module B (Ngân sách & Sức khỏe tài chính)

> Trạng thái: **đã duyệt (17/08/2026)**. P1a hoàn thành ở v2.1.0, P1b ở v2.2.0, P1c ở v2.3.0, P1d-1 (công nợ, ảnh hóa đơn, onboarding) ở v2.4.0, P1d-2 (wizard CSV/Excel + sao kê VN, PIN + mã hóa) ở v2.5.0 — **P1 hoàn tất**; tiếp theo P2 (Module C, D). Song ngữ làm ở P1a; PIN/mã hóa ở P1d.

## 0. Nguyên tắc giữ nguyên từ P0
- Static, không backend, không API key; vanilla ES modules; không framework.
- Không mất dữ liệu: `migrate()` v2 → v3 thuần túy, có test; key cũ giữ nguyên.
- Mọi text qua `textContent`; mọi thứ offline; SW precache theo `CACHE_VERSION`.
- Mỗi giai đoạn con (P1a…P1d) là **một bản deploy được**, không chờ xong hết P1.

## 1. Kiến trúc & điều hướng

```
index.html                 app shell: header + <main id="view"> + tab bar dưới cùng
js/
  main.js                  boot, router, mount views
  router.js                hash router: #/home #/tx #/budget #/invest(P2) #/news(P2) #/settings
  state.js                 store trung tâm (slices: transactions, accounts, categories, recurring, budgets, goals, debts, assets, settings)
  storage.js               localStorage + IndexedDB (IDB thêm store 'blobs' cho ảnh hóa đơn)
  migrate.js               v1→v2 (đã có) + v2→v3
  utils/                   (đã có) + fmt.js (i18n số/ngày), search.js (chuẩn hóa tiếng Việt không dấu)
  features/
    accounts.js            ví/tài khoản, số dư theo ví, chuyển khoản, thẻ tín dụng (sao kê/đến hạn)
    categories.js          danh mục 2 cấp, gộp/sửa/xóa, nhóm 50/30/20 mặc định
    recurring.js           tổng quát hóa (ngày/tuần/tháng/năm, bỏ qua 1 kỳ) — lương là 1 rule
    filters.js             tìm kiếm & lọc + bộ lọc đã lưu
    budgets.js             ngân sách theo danh mục, cảnh báo 80/100%, so sánh TB 3 tháng
    rule503020.js          phân loại thiết yếu / mong muốn / tiết kiệm-đầu tư
    emergencyFund.js       chi thiết yếu TB 6 tháng → mục tiêu 3/6/12 tháng
    goals.js               sinking funds: cần để dành X/tháng
    debts.js               lịch trả nợ, snowball vs avalanche, trả sớm
    networth.js            tài sản & nợ → net worth theo tháng (snapshot)
    forecast.js            dự báo dòng tiền 3–6 tháng
    health.js              điểm sức khỏe 0–100, minh bạch từng thành phần
    insights.js            insight tự động (so với TB, top 5, subscription quên hủy…)
    achievements.js        tier gắn vào điểm sức khỏe + streak + huy hiệu
    importExport.js        (đã có) + wizard map cột, mẫu sao kê ngân hàng VN
  views/
    home.js                thẻ kéo-thả: số dư ví, ngân sách tháng, mục tiêu, net worth, insight
    transactions.js        form nhanh + danh sách ảo + tìm kiếm/lọc + chi tiết (ảnh, tag, nợ)
    budget.js              ngân sách, 50/30/20, quỹ khẩn cấp, mục tiêu, nợ, net worth, dự báo, điểm sức khỏe
    settings.js            ví, danh mục, định kỳ, giao diện (dark/theme), dữ liệu, chính sách
  ui/                      (đã có) + tabs.js, sheet.js (bottom sheet tổng quát), cards.js (kéo-thả), theme.js
css/app.css + css/dark.css (biến màu; prefers-color-scheme + toggle)
tests/                     + migrate-v3, recurring, budgets, debts, health, forecast, filters
```

## 2. Schema v3 (`mm_data_v3`)

```js
{
  schemaVersion: 3, savedAt,
  accounts: [{ id, name, type: 'cash'|'bank'|'ewallet'|'credit', openingBalance, color, icon, archived,
               credit?: { limit, statementDay, dueDay } }],
  categories: [{ id, name, parentId|null, kind: 'expense'|'income'|'both', icon, color, group: 'need'|'want'|'save'|null, archived }],
  transactions: [{ id, type: 'income'|'expense'|'transfer', amount, date, createdAt, updatedAt?, note,
                   accountId, toAccountId?,            // transfer: từ accountId → toAccountId, không tính thu/chi
                   categoryId, category,               // giữ `category` (tên) để tương thích & hiển thị nhanh
                   tags: [], receiptId?,               // ảnh trong IDB store 'blobs' (nén ≤ ~200 KB)
                   debt?: { kind: 'lend'|'borrow', person, settledAt? },
                   source: 'manual'|'recurring'|'import'|'auto-salary', recurringId?, periodKey?, deletedAt? }],
  recurring: [{ id, name, enabled, template: { type, amount, categoryId, accountId, toAccountId?, note, tags },
                freq: 'daily'|'weekly'|'monthly'|'yearly', interval, byDay?, byMonthDay?, startDate, endDate?,
                lastPeriod, skippedPeriods: [] }],
  budgets: [{ id, categoryId|null, amount, period: 'monthly', startYM, note }],
  goals: [{ id, name, target, deadline, accountId?, contributions: [{date, amount}], icon }],
  debts: [{ id, name, principal, rate, termMonths, startDate, paymentDay, kind: 'loan'|'installment'|'creditcard', extraPayments: [] }],
  assets: [{ id, name, type: 'cash'|'savings'|'stock'|'fund'|'gold'|'realestate'|'vehicle'|'crypto'|'other', value, updatedAt, liability: false }],
  snapshots: { networth: [{ ym, assets, liabilities }] },
  meta: { savedFilters: [], cardOrder: [], streak: { current, best, lastDay }, badges: [] }
}
```
`mm_settings_v3`: + `theme: 'system'|'light'|'dark'`, `locale: 'vi'|'en'`, `rule503020: {need:50, want:30, save:20}`, `emergencyMonths: 6`, `healthWeights`, `defaultAccountId`.

### Migration v2 → v3 (thuần, có test)
1. Tạo ví mặc định `Tiền mặt` (cash) → mọi giao dịch cũ `accountId = cash`.
2. Tạo danh mục cấp 1 từ các tên `category` đang có (giữ nguyên tên), gán `categoryId`; gán `group` mặc định theo bảng ánh xạ (Ăn uống/Hóa đơn/Nhà cửa/Đi lại/Sức khỏe/Giáo dục → need; Mua sắm/Giải trí → want; Tiết kiệm/Đầu tư → save; còn lại null → hỏi người dùng khi mở tab Ngân sách).
3. Lương: `settings.salary > 0` → 1 rule `recurring` (monthly, byMonthDay 1, `lastPeriod = settings.lastSalaryPeriod`); giao dịch `source:'auto-salary'` giữ nguyên, thêm `recurringId`. Cơ chế bù kỳ thiếu của P0 trở thành trường hợp riêng của engine recurring.
4. `mm_data_v2` giữ nguyên (phao cứu sinh, như v1).

## 3. Lộ trình con — mỗi bước là một bản deploy

| Bước | Nội dung | Ước lượng |
|---|---|---|
| **P1a — Nền tảng** | Schema v3 + migration; router + **tab dưới cùng**; **dark mode**; ví/tài khoản + chuyển khoản + thẻ tín dụng; danh mục 2 cấp + tag; recurring tổng quát (thay lương); form nhập nhanh (nhớ danh mục gần nhất, gợi ý ghi chú, lặp lại giao dịch, Enter); tìm kiếm & lọc + bộ lọc đã lưu; Cài đặt tách trang | lớn nhất |
| **P1b — Ngân sách** | Ngân sách theo danh mục (80/100%, so TB 3 tháng); 50/30/20; quỹ khẩn cấp; mục tiêu tiết kiệm; insight tự động; trang chủ dạng thẻ kéo-thả | vừa |
| **P1c — Nợ, tài sản, sức khỏe** | Quản lý nợ (lịch trả, snowball/avalanche, trả sớm); net worth; dự báo dòng tiền 3–6 tháng; điểm sức khỏe 0–100 minh bạch; tier gắn điểm sức khỏe + streak + huy hiệu; biểu đồ mới (dòng tiền, so sánh tháng, heatmap ngày; sankey ở P2 nếu cần) | vừa |
| **P1d — Dữ liệu** | Ảnh hóa đơn (nén, IDB); công nợ cho mượn/mượn + màn hình tổng hợp; wizard map cột CSV + mẫu sao kê VN (Vietcombank/Techcombank/MB/BIDV… dạng CSV/XLSX xuất từ app ngân hàng); onboarding 60 giây; khóa PIN + mã hóa (WebCrypto) — hoặc lùi sang P2 nếu muốn ưu tiên Module C | vừa |

Unit test cho: migration v3, recurring engine, ngân sách, lịch trả nợ, điểm sức khỏe, dự báo, tìm kiếm không dấu. E2E bổ sung cho từng bước.

## 4. Quyết định cần bạn chốt
1. Duyệt kiến trúc + schema + lộ trình 4 bước trên?
2. Song ngữ Việt/Anh: làm ngay ở P1a (rẻ hơn khi text còn ít) hay lùi P2?
3. Khóa PIN + mã hóa: P1d hay P2?
4. Deploy: sau mỗi bước con (khuyến nghị) hay gộp một lần cuối P1?
