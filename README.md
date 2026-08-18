# Quản Lý Chi Tiêu (moneymoney)

PWA quản lý thu chi cá nhân cho người dùng Việt Nam. **Static site**, chạy trên GitHub Pages, **offline hoàn toàn**, dữ liệu **chỉ nằm trên thiết bị** (localStorage + IndexedDB), không backend, không analytics.

🔗 https://trile0000.github.io/moneymoney/

## Tính năng (bản 2.6.2)

- **Nhiều ví/tài khoản** (tiền mặt, ngân hàng, ví điện tử, thẻ tín dụng có ngày sao kê/đến hạn), **chuyển khoản giữa ví**, số dư từng ví.
- **Danh mục 2 cấp** có icon/màu/nhóm 50-30-20, **tag** tự do, **giao dịch định kỳ** tổng quát (ngày/tuần/tháng/năm, bù kỳ thiếu, bỏ qua 1 kỳ).
- Thêm nhanh / **sửa (bottom sheet)** / **xóa có Hoàn tác 5 giây**; nhập số tiền gõ tắt `50k`, `1tr5`, `1.250.000` có xác nhận ngay dưới ô; nhớ danh mục/ví gần nhất, gợi ý ghi chú, lặp lại giao dịch.
- **Tìm kiếm không dấu & lọc** (thời gian, loại, ví, danh mục, tag, khoảng tiền), bộ lọc đã lưu.
- **Ngân sách theo danh mục** (80/100%, so TB 3 tháng), **quy tắc 50/30/20**, **quỹ khẩn cấp** 3/6/12 tháng, **mục tiêu tiết kiệm** (cần X/tháng), **insight tự động**; Trang chủ dạng thẻ sắp xếp được.
- **Quản lý nợ** (lịch trả niên kim, trả thêm, snowball vs avalanche, mô phỏng trả sớm), **tài sản ròng** (ví + tài sản khai báo − nợ, snapshot hàng tháng), **dự báo dòng tiền 3–12 tháng**, **điểm sức khỏe tài chính 0–100** minh bạch (5 thành phần, trọng số tùy chỉnh), **streak & huy hiệu**.
- **Công nợ cá nhân** (cho mượn / đi mượn / thu–trả nợ theo người, tính vào tài sản ròng), **ảnh hóa đơn** nén lưu IndexedDB (kèm được vào sao lưu), **onboarding 60 giây** cho người mới.
- **Nhập CSV/Excel bằng wizard** (tự dò dòng tiêu đề, mẫu sao kê Vietcombank/Techcombank/MB/BIDV/VPBank/TPBank/ACB/MoMo/Money Lover, ánh xạ cột, tự gán danh mục theo nội dung, lưu mẫu), **khóa PIN & mã hóa AES-256** trên máy với mã khôi phục, tự khóa.
- **Phân bổ đầu tư theo lớp tài sản** (Module C): hồ sơ rủi ro 6 câu → tỉ trọng mục tiêu, so với tài sản hiện có, điều kiện tiên quyết (quỹ khẩn cấp, nợ lãi cao), kế hoạch góp đều & dự phóng theo lợi suất giả định — luôn kèm disclaimer, **không gợi ý mã cụ thể**.
- **Tab dưới cùng**, **dark mode**, **song ngữ Việt/Anh**.
- Tổng kết theo tháng, mascot hổ + 5 tier (ngưỡng & thông điệp tùy chỉnh), kỷ lục — chỉ tính cho tháng hiện tại.
- Biểu đồ danh mục / thu-chi / biến động 12 tháng / dòng tiền tích lũy / so sánh tháng trước / heatmap chi theo ngày (Chart.js self-host), ghi rõ phạm vi dữ liệu.
- **Lương định kỳ** tự sinh ngày 01, **bù đủ kỳ thiếu** dù không mở app đúng ngày.
- **Xuất CSV** (RFC 4180, BOM UTF-8 — mở Excel tiếng Việt đúng), **Sao lưu / Khôi phục JSON** (tùy chọn kèm ảnh hóa đơn).
- Danh sách ảo hóa — mượt với 10.000+ giao dịch. Accessibility: bàn phím, ARIA, bẫy focus, reduced-motion.
- Service worker network-first cho HTML/JS/CSS + banner "Có phiên bản mới" → không kẹt bản cũ.

## Cấu trúc

```
index.html              markup thuần (4 view + tab bar; không inline JS/CSS)
css/app.css             style, biến màu sáng/tối, @font-face self-host
js/
  main.js               điểm vào: boot, luồng dùng chung (sửa/xóa/undo/nhập/xuất), theme, i18n, SW
  router.js             hash router #/home #/tx #/budget #/settings
  i18n.js               từ điển vi/en, t(), applyI18n()
  version.js            APP_VERSION (đổi bằng scripts/bump-version.mjs)
  state.js              state trong bộ nhớ (giao dịch, ví, danh mục, định kỳ), chỉ mục memoized, mutation
  storage.js            localStorage + IndexedDB, quota, migration khi load
  migrate.js            schema v1 → v2 → v3 (thuần, có test)
  utils/                id (uuid), date (local YYYY-MM-DD), money (parser VND), csv (RFC 4180), dom (el/trapFocus)
  features/             accounts, categories, recurring, filters, budgets, rule503020, emergencyFund, goals, insights, achievements (tier/streak/huy hiệu), debts, networth, forecast, health, iou (công nợ), importExport, csvWizard (engine nhập), crypto (PIN/AES-GCM), allocation (Module C)
  views/                home (thẻ sắp xếp được), tx (thêm nhanh + lọc + danh sách), budget (ngân sách/50-30-20/quỹ/mục tiêu/insight), wealth (sức khỏe/nợ/tài sản ròng/dự báo), iou (công nợ), invest (phân bổ đầu tư), settings, security (PIN/mã hóa)
  ui/                   list (virtual), editSheet, formSheet, pickers, confirm, modal, undo, gestures, charts, amountInput, toast, confetti, theme, swUpdate, receipt (ảnh hóa đơn), onboarding, csvWizard (3 bước), lock (màn hình khóa)
service-worker.js       precache app shell, network-first HTML/JS/CSS, cache-first asset
vendor/chart.umd.js     Chart.js 4.4.7 (MIT); vendor/xlsx.mini.min.js SheetJS 0.18.5 (Apache-2.0) đọc Excel
assets/fonts/           Baloo 2, Quicksand — woff2 subset Latin+Vietnamese (OFL)
assets/mascot/sm/       mascot 192px webp/png dùng trong app (bản 1024px gốc giữ ở assets/mascot/)
tests/                  unit test (node --test) + e2e.mjs (Playwright)
docs/P0-review.md       xác nhận 27 lỗi P0 + lỗi bổ sung
docs/P1-plan.md         kế hoạch P1 (P1a–P1d đã xong)
docs/P2-plan.md         P2 = Module C phân bổ đầu tư (v2.6.0); Module D đã bỏ theo quyết định
scripts/bump-version.mjs
```

## Dữ liệu

- `mm_data_v3`: `{ schemaVersion: 3, transactions, accounts, categories, recurring, budgets, goals, debts, assets, snapshots, meta, savedAt }`
- Giao dịch: `{ id, type: 'income'|'expense'|'transfer', amount, categoryId, category (tên), accountId, toAccountId?, tags[], note, date: 'YYYY-MM-DD' (giờ địa phương), createdAt, updatedAt?, source: 'manual'|'recurring'|'import'|'auto-salary', recurringId?, periodKey?, deletedAt? }`
- Ví: `{ id, name, type: 'cash'|'bank'|'ewallet'|'credit', openingBalance, color, icon, archived, credit?: { limit, statementDay, dueDay } }`
- Danh mục: `{ id, name, parentId|null, kind: 'expense'|'income'|'both', icon, color, group: 'need'|'want'|'save'|null, archived }`
- Định kỳ: `{ id, name, enabled, template: { type, amount, categoryId, accountId, toAccountId?, note, tags }, freq, interval, byMonthDay, startDate, endDate?, lastDate (watermark), skippedDates[], legacySalary }`
- `mm_settings_v3`: theme, locale, defaultAccountId, lastCategoryId/lastAccountId, savedFilters, ngưỡng tier, thông điệp, bestTier…
- Key cũ `mm_transactions_v1` / `mm_data_v2` **được giữ nguyên** sau khi nâng cấp (phao cứu sinh). Mọi lần lưu ghi song song vào IndexedDB `moneymoney/kv`; ảnh hóa đơn nằm trong store `moneymoney/blobs` (key = id giao dịch). Khi bật mã hóa, `mm_data_v3` (cả localStorage lẫn IDB) là envelope `{ enc: 1, meta: { salt, saltR, iter, wrapPin, wrapRec }, iv, ct }` — AES-GCM-256, khóa dữ liệu bọc bằng PBKDF2(PIN) và PBKDF2(mã khôi phục); cài đặt vẫn dạng thường; key v1/v2 dạng thường bị xóa khi bật.

## Phát triển

```bash
npm test                        # 83 unit test (node >= 20, không cần cài gì)
python3 -m http.server 8080     # hoặc bất kỳ static server nào
node tests/e2e.mjs              # Playwright headless (cần `npm i -D playwright` + Chromium)
```

Không có bước build. Mở `index.html` qua HTTP (không mở file:// vì ES modules + service worker).

## Deploy (GitHub Pages)

1. `node scripts/bump-version.mjs 2.0.1` — đổi đồng thời `APP_VERSION` và `CACHE_VERSION` (bắt buộc mỗi lần deploy để precache mới).
2. Commit & push lên `main`. GitHub Pages phục vụ từ root.
3. Người dùng đang mở app sẽ thấy banner **"🆕 Có phiên bản mới — Tải lại"**; người dùng mở lại app nhận bản mới ngay (HTML network-first).

## Cài lên điện thoại

- iPhone: Safari → Chia sẻ → **Thêm vào MH chính**. Android: Chrome → menu → **Cài đặt ứng dụng**.
- Sau lần mở đầu tiên, app dùng được offline hoàn toàn (kể cả biểu đồ và font).

## Kiểm thử thủ công sau deploy (checklist)

- [ ] Mở app trên máy đã có dữ liệu cũ → toast "Đã nâng cấp dữ liệu (N giao dịch)", số giao dịch không đổi, `mm_transactions_v1` vẫn còn trong DevTools.
- [ ] Gõ `50k`, `1tr5`, `1.250.000` → hint đúng; thêm với số tiền 0 hoặc danh mục trống → báo lỗi.
- [ ] Vuốt trái / bấm ✕ → snackbar Hoàn tác; bấm Hoàn tác → quay lại; đợi 5s → mất hẳn.
- [ ] Chạm dòng → sheet sửa; đổi Thu/Chi, số tiền, lưu → cập nhật.
- [ ] Đổi sang tháng cũ nhiều tiền → không confetti, Kỷ lục trong Cài đặt không đổi.
- [ ] Cài đặt → Xuất CSV → mở Excel: đúng cột, dấu tiếng Việt, ghi chú có dấu phẩy không vỡ cột.
- [ ] Sao lưu JSON → Xóa tất cả (2 bước) → Khôi phục JSON (Thay thế) → dữ liệu về như cũ.
- [ ] Bật chế độ máy bay → mở lại app → vẫn hiện danh sách + biểu đồ + đúng font.
- [ ] Deploy bản mới (đổi version) → app đang mở hiện banner "Có phiên bản mới".

## Giấy phép

Mã nguồn: MIT. Chart.js: MIT (`vendor/chart.LICENSE.md`). Font Baloo 2 & Quicksand: SIL OFL 1.1 (`assets/fonts/OFL-*.txt`).
