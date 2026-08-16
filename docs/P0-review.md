# P0 — Rà soát & sửa 27 lỗi (bản 2.0.0)

Tài liệu này xác nhận từng lỗi trong mục 0.5 của prompt nâng cấp: **đúng/không đúng**, cách sửa, và file liên quan. Cuối tài liệu là các lỗi **bổ sung** phát hiện thêm và những gì được **cố ý lùi sang P1**.

Ký hiệu: ✅ xác nhận đúng & đã sửa · ⚠️ đúng một phần (ghi rõ) · ➕ lỗi bổ sung.

## Nhóm 1 — Nguy cơ mất dữ liệu

| # | Kết luận | Cách sửa | File |
|---|---|---|---|
| 1 | ✅ Đúng. `Date.now().toString()` trùng khi thêm nhanh/import; `removeOne` lọc theo id nên xóa cả cụm. | `uuid()` dùng `crypto.randomUUID()` (fallback `getRandomValues`). Migration cấp UUID mới cho bản ghi trùng id nhưng **không mất bản ghi nào**. Test: 10.000 id trong vòng lặp đều duy nhất. | `js/utils/id.js`, `js/migrate.js`, `tests/csv-id-date.test.mjs`, `tests/migrate.test.mjs` |
| 2 | ✅ Đúng. Vuốt trái −80px xóa ngay, không hoàn tác. | **Xóa mềm** (`deletedAt`) + snackbar **Hoàn tác 5 giây** (đếm ngược, Ctrl/Cmd+Z). Hết 5s hoặc rời trang mới xóa hẳn. Áp dụng cho cả nút ✕, vuốt trái và nút Xóa trong form sửa. | `js/state.js` (softDelete/restore/purgeDeleted), `js/ui/undo.js`, `js/main.js` |
| 3 | ✅ Đúng. `localStorage.setItem` trần. | `storage.js` bọc try/catch, nhận diện `QuotaExceededError`; **mọi lần ghi đều ghi song song IndexedDB**; nếu localStorage lỗi vẫn ghi IDB và phát sự kiện để UI hiện cảnh báo đỏ 8s ("Sao lưu JSON ngay"). Khi mở app, nếu localStorage trống/hỏng mà IDB có dữ liệu → tự khôi phục. Đã test giả lập quota. | `js/storage.js`, `js/main.js` |
| 4 | ✅ Đúng. | Hộp thoại 2 bước: bước 1 có nút **💾 Sao lưu JSON** ngay trong hộp thoại; bước 2 phải **tick xác nhận** mới bật nút "Xóa vĩnh viễn". Không dùng `confirm()`. Cài đặt được giữ. | `js/ui/confirm.js`, `js/main.js` (`clearAllFlow`) |
| 5 | ✅ Đúng. | Thêm **Nhập CSV** (tự đoán cột theo tên VN/EN, hiểu `dd/MM/yyyy`, ISO, `1.250.000`, `15tr`, Thu/Chi; khử trùng theo id + vân tay `date|type|amount|category|note`; xem trước 5 dòng trước khi thêm), **Sao lưu JSON** đầy đủ (giao dịch + cài đặt) và **Khôi phục JSON** (Gộp hoặc Thay thế, có tick xác nhận). Đọc được cả file backup v1 (mảng thuần). | `js/features/importExport.js`, `js/utils/csv.js`, `js/main.js` |

## Nhóm 2 — Logic sai số liệu

| # | Kết luận | Cách sửa | File |
|---|---|---|---|
| 6 | ✅ Đúng. | Cơ chế **kỳ còn thiếu**: lưu `settings.lastSalaryPeriod` ('YYYY-MM'); mỗi lần mở app (và mỗi lần quay lại tab) duyệt mọi kỳ từ `lastSalaryPeriod+1` tới tháng hiện tại, sinh lương ngày 01 cho kỳ thiếu. Lần đầu chạy cơ chế mới: bắt đầu từ kỳ lương tự động sớm nhất trong dữ liệu cũ (nếu có) hoặc tháng hiện tại — **không bù ngược lịch sử** để tránh bịa thu nhập. Bật lương từ 0 → chỉ sinh tháng hiện tại. Test: 3 tháng không mở → bù đủ 3 kỳ. | `js/features/recurring.js`, `js/main.js` (`runSalaryBackfill`), `tests/recurring.test.mjs` |
| 7 | ✅ Đúng. | Cờ `source: 'auto-salary'` + `periodKey: 'YYYY-MM'`. Migration nhận diện lương cũ qua note `'Tự động thêm từ hệ thống'` (chỉ 1 lần, khi chuyển v1→v2). Nếu tháng đó đã có khoản thu **thủ công** đúng danh mục lương (so sánh nguyên chuỗi, không `includes`) → coi là đã có. "Thưởng lương tháng 13" không còn chặn nhầm; đổi danh mục lương thành "Thu nhập" không sinh trùng. Người dùng xóa lương tự động → không bị thêm lại (kỳ đó ≤ `lastSalaryPeriod`). | như trên |
| 8 | ✅ Đúng. | Parser `parseAmount()` hiểu `k / nghìn / ngàn / n / tr / triệu / m / tỷ / tỉ / b`, phần lẻ (`1tr5`, `1tr250`), cộng dồn (`1tr250k`), thập phân (`1.5tr`, `1,5m`), ký hiệu tiền ở cuối. **Không hiểu → trả `null` và báo lỗi**, không âm thầm ra số sai. Ô nhập hiển thị "= 1.500.000 đ" ngay bên dưới; blur → chuẩn hóa. Áp dụng cho form thêm, form sửa, ô lương & 3 ngưỡng trong Cài đặt. 39 test. | `js/utils/money.js`, `js/ui/amountInput.js`, `tests/money.test.mjs` |
| 9 | ✅ Đúng. | Bắt buộc `amount > 0`, danh mục không rỗng, ngày hợp lệ (`isValidYMD`, kể cả 30/02). Lỗi hiện inline (`role=alert`), focus vào ô sai, `aria-invalid`. `normalizeTransaction()` cũng phòng thủ ở tầng dữ liệu. | `js/main.js` (`addFlow`), `js/ui/editSheet.js`, `js/migrate.js` |
| 10 | ✅ Đúng. | Tách `date` ('YYYY-MM-DD', giờ địa phương, do người dùng chọn) khỏi `createdAt` (ms, thời điểm ghi). Mọi lọc/tổng hợp theo `date.slice(0,7)` — **không parse Date** nên không lệch múi giờ. Migration suy `date` từ `createdAt` theo giờ máy tại thời điểm nâng cấp. Test chạy dưới TZ UTC / LA / Auckland / HCM. | `js/utils/date.js`, `js/migrate.js`, `js/state.js` |
| 11 | ✅ Đúng. | Tách **tier hiển thị** (theo tháng đang xem) khỏi **sự kiện thành tựu** (chỉ tính trên tháng hiện tại, chỉ khi `reason === 'data'`: thêm/sửa/xóa/import; đổi bộ lọc tháng hay đổi biểu đồ không bao giờ bắn confetti/ghi `bestTier`). Lưu thêm `bestTierMonth`. E2E: xem tháng cũ 90tr → `bestTier` không đổi. | `js/features/achievements.js`, `js/main.js` (`render`) |

## Nhóm 3 — Bảo mật

| # | Kết luận | Cách sửa | File |
|---|---|---|---|
| 12 | ✅ Đúng. | Loại bỏ **toàn bộ** `innerHTML`. Helper `el()` chỉ dùng `textContent`/`setAttribute`. E2E: danh mục `<img src=x onerror=…>` hiển thị nguyên văn, không có `<img>` trong DOM, không thực thi. Import CSV/JSON đi qua cùng đường render nên cũng an toàn. | `js/utils/dom.js`, `js/ui/list.js`, toàn bộ `js/ui/*` |
| 13 | ✅ Đúng. | **Self-host** `vendor/chart.umd.js` (Chart.js **4.4.7**, kèm LICENSE), không còn CDN, không phụ thuộc mạng. (SRI không cần vì cùng origin.) | `vendor/`, `index.html` |

## Nhóm 4 — Service Worker

| # | Kết luận | Cách sửa | File |
|---|---|---|---|
| 14 | ✅ Đúng — đây là lý do "deploy mà không thấy đổi". | **Network-first** (timeout 4s → cache) cho navigation/HTML/JS/CSS; **cache-first** cho ảnh/font/vendor/manifest. Cache tên theo `CACHE_VERSION`. | `service-worker.js` |
| 15 | ✅ Đúng. | Bỏ `ignoreSearch`. | `service-worker.js` |
| 16 | ✅ Đúng. | Không `skipWaiting()` khi install. Trang lắng nghe `updatefound` → hiện banner "🆕 Có phiên bản mới — Tải lại"; bấm mới `postMessage('SKIP_WAITING')` → `controllerchange` → reload 1 lần. Kiểm tra bản mới mỗi khi quay lại tab. **Ngoại lệ có chủ đích**: nếu phát hiện cache SW cũ (`expense-cache-*`) thì `skipWaiting()` một lần, vì trang cũ không có banner — nếu không, người dùng cũ phải đóng hẳn app mới nhận được bản này. | `service-worker.js`, `js/ui/swUpdate.js` |
| 17 | ✅ Đúng. | Self-host Chart.js + font **Baloo 2 / Quicksand** (woff2 subset Latin+Vietnamese, 39 KB + 32 KB, giữ trục biến thiên `wght`) → precache toàn bộ app shell (42 file). E2E: bật offline → reload → app mở, có biểu đồ, `document.fonts.check('16px "Baloo 2"') === true`, hiện badge "Offline". | `assets/fonts/`, `css/app.css`, `service-worker.js` |

## Nhóm 5 — Hiệu năng & kiến trúc

| # | Kết luận | Cách sửa | File |
|---|---|---|---|
| 18 | ✅ Đúng. | State trong bộ nhớ là nguồn sự thật; `saveData()` so sánh JSON và **chỉ ghi khi đổi**; đổi tháng/đổi biểu đồ không ghi. | `js/state.js`, `js/storage.js` |
| 19 | ✅ Đúng. | **Virtual list**: chỉ render các dòng trong khung nhìn (+6 overscan), tái sử dụng node theo id, giữ thứ tự DOM = thứ tự hiển thị (trình đọc màn hình/Tab đúng thứ tự). E2E với 10.000 giao dịch: tải 235 ms, DOM 15–22 dòng, đổi tháng 8 lần 483 ms. | `js/ui/list.js` |
| 20 | ✅ Đúng. | Chỉ mục theo tháng `Map<'YYYY-MM', {income, expense, items}>` tính 1 lần sau mỗi thay đổi; biểu đồ biến động đọc từ chỉ mục, không `load()` lại. | `js/state.js` (`getMonthIndex`), `js/ui/charts.js` |
| 21 | ✅ Đúng. | Tách thành ES modules: `js/state.js`, `js/storage.js`, `js/migrate.js`, `js/utils/`, `js/features/`, `js/ui/`, `css/app.css`; `index.html` chỉ còn markup. Không biến toàn cục (trừ `window.__mm` cho kiểm thử). 64 unit test + 44 kiểm tra E2E. | toàn bộ |

## Nhóm 6 — UX & khả năng tiếp cận

| # | Kết luận | Cách sửa | File |
|---|---|---|---|
| 22 | ✅ Đúng. | **Bottom sheet** sửa giao dịch: chọn Thu/Chi bằng segmented control, ngày, số tiền (có parser + hint), danh mục, ghi chú, nút Xóa (có Undo). Enter lưu, Esc đóng, bẫy focus. Không còn `prompt()`. | `js/ui/editSheet.js`, `index.html` |
| 23 | ✅ Đúng. | Gesture gắn vào **viewport danh sách**; bỏ qua khi chạm vào `button`; **khóa hướng**: |dx|>12 và |dx|>1.5·|dy| → ngang, ngược lại → dọc (hủy swipe & long-press). Chặn `click` phát sinh sau swipe/long-press. Đã test bằng CDP touch: vuốt dọc không xóa, vuốt trái xóa (có Undo), giữ 500ms mở sửa, chạm ✕ chỉ xóa. | `js/ui/gestures.js` |
| 24 | ✅ Đúng. | `touchmove` đăng ký `{ passive: false }` **chỉ trên viewport danh sách**, chỉ `preventDefault()` khi đã khóa hướng ngang; `touchstart/touchend` vẫn passive. `.tx { touch-action: pan-y }`. | `js/ui/gestures.js`, `css/app.css` |
| 25 | ✅ Đúng. | CSV RFC 4180: bọc ngoặc kép khi có `, " \n`, escape `""`, CRLF, **BOM `\uFEFF`**; cột `date,type,amount,category,note,id,createdAt,source`. Xuất theo tháng đang lọc hoặc tất cả. Round-trip xuất→nhập trong test. | `js/utils/csv.js`, `js/features/importExport.js` |
| 26 | ✅ Đúng. | `aria-label` đầy đủ cho nút xóa và từng dòng; dòng focus được (`tabindex=0`, Enter=sửa, Delete=xóa); modal/sheet: `role=dialog`, `aria-modal`, `aria-labelledby`, **bẫy focus**, Esc, click nền, trả focus về chỗ cũ; canvas biểu đồ `role=img` + `aria-label` mô tả số liệu; `aria-live` cho KPI/toast/undo; skip-link; contrast `--muted` nâng lên `#6f625d` (AA); `prefers-reduced-motion` tắt animation/confetti. | `js/utils/dom.js` (`trapFocus`), `js/ui/modal.js`, `js/ui/charts.js`, `css/app.css` |
| 27 | ✅ Đúng. | Dòng "Phạm vi: …" dưới mỗi biểu đồ ("chi tiêu T08/2026" / "toàn bộ lịch sử, 12 tháng gần nhất (không theo bộ lọc tháng)"), nút "Tháng này", danh sách ghi tháng đang xem. Biểu đồ biến động chọn Donut → tự chuyển Cột (donut vô nghĩa với chuỗi thời gian). | `js/ui/charts.js`, `js/main.js` |

## ➕ Lỗi bổ sung phát hiện & đã sửa trong P0

| # | Vấn đề | Cách sửa |
|---|---|---|
| 28 | Mascot PNG **1024×1024, ~1.5 MB/ảnh** (7 ảnh ≈ 10 MB) nhưng chỉ hiển thị 80 px → tải chậm, Lighthouse Performance thấp. | Sinh `assets/mascot/sm/*.webp` (192 px, ~8–11 KB) + PNG fallback; app chỉ dùng bản nhỏ; ảnh gốc giữ lại trong repo (không dùng ở runtime). |
| 29 | `manifest.json` trỏ 1 ảnh 1024 px cho cả 192/512 và gắn `any maskable` cùng ảnh; `assets/icon-*.png` cũ là icon "đ" xanh không dùng. | Sinh icon 192/512 từ logo hổ, `icon-512-maskable.png` có đệm nền, `apple-touch-icon` 180 px nền trắng, favicon 64. Thêm `id`, `lang`, `description`. |
| 30 | `add()`: ô ngày rỗng → `new Date('')` = Invalid → `createdAt = NaN` → giao dịch "ma" không hiện ở tháng nào. | Validate ngày; `normalizeTransaction` ép `createdAt` hợp lệ. |
| 31 | `render()` mutate `createdAt` cho bản ghi thiếu rồi ghi lại đĩa mỗi lần render. | Chuẩn hóa 1 lần trong migration. |
| 32 | Ngưỡng Tier là `input type=number` không hiểu gõ tắt; đặt ngưỡng nhỏ hơn nhau âm thầm bị "ép". | Dùng cùng amount input (có hint); vẫn ép t2 ≤ t3 ≤ t4 nhưng hiển thị giá trị đã ép ngay. |
| 33 | Chỉ bắt `window.onerror`, promise reject không hiện. | Bắt thêm `unhandledrejection`. |
| 34 | Toast lỗi bị toast thành công đè mất (VD cảnh báo quota bị "Đã thêm" che). | Toast lỗi/cảnh báo giữ chỗ tới hết thời lượng. |
| 35 | Thiếu meta iOS PWA (`apple-mobile-web-app-capable`, title), thiếu `description`. | Bổ sung. |
| 36 | SW cũ `activate` xóa **mọi** cache khác trên origin (kể cả của app khác cùng domain GitHub Pages). | Chỉ xóa cache tiền tố `mm-` / `expense-cache`. |
| 37 | Không có phiên bản app hiển thị → khó biết người dùng đang chạy bản nào. | `js/version.js` + footer `v2.0.0`; `scripts/bump-version.mjs` đổi đồng bộ với `CACHE_VERSION`. |
| 38 | Danh mục "Lương" không có trong datalist gợi ý. | Thêm. |

## Điều CHƯA làm trong P0 (chủ ý lùi sang P1/P2)

- Dark mode, song ngữ, tab dưới cùng, nhiều ví, danh mục 2 cấp, giao dịch định kỳ tổng quát (P0 mới tổng quát hóa cơ chế lương thành `source/periodKey` — tương thích ngược, sẵn sàng mở rộng), wizard map cột CSV thủ công (P0 tự đoán cột), khóa PIN/mã hóa.
- Lighthouse chưa chạy được trong môi trường build (không có mạng cài Lighthouse). Các yếu tố chính đã xử lý: không CDN, font subset + preload, ảnh nhỏ, JS module tách nhỏ, a11y đầy đủ. Đề nghị chạy Lighthouse trên site sau deploy và gửi kết quả để tinh chỉnh.

## Chiến lược migration & an toàn dữ liệu

- Đọc `mm_transactions_v1` + `mm_settings_v1` → ghi `mm_data_v2` (`{schemaVersion:2, transactions, meta, savedAt}`) + `mm_settings_v2`. **Key v1 được giữ nguyên, không xóa** (phao cứu sinh); ghi mốc `mm_migrated_v1_at`.
- Mọi lần lưu ghi song song localStorage + IndexedDB (`moneymoney/kv`). Khi mở app, nếu IDB mới hơn/đầy đủ hơn → dùng IDB.
- `migrate()` thuần túy, idempotent, không ném lỗi, có test.
