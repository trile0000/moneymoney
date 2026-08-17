# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.0.0/). Phiên bản = `APP_VERSION` = `CACHE_VERSION`.

## [2.1.0] — 2026-08-17 — P1a: nền tảng Module A (ví, danh mục 2 cấp, định kỳ tổng quát, lọc, tab, dark mode, song ngữ)

### Thêm
- **Schema v3** (`mm_data_v3`): ví/tài khoản, danh mục 2 cấp (icon, màu, nhóm 50/30/20), tag, chuyển khoản giữa ví (không tính thu/chi), giao dịch định kỳ tổng quát; migration v1/v2 → v3 tự động, key cũ giữ nguyên, có test.
- **Ví & tài khoản**: Tiền mặt / Ngân hàng / Ví điện tử / Thẻ tín dụng (hạn mức, ngày sao kê, ngày đến hạn, cảnh báo ≤ 5 ngày); số dư từng ví, tổng tài sản / nợ thẻ / ròng; chuyển khoản; lưu trữ hoặc xóa kèm chuyển giao dịch sang ví khác.
- **Danh mục 2 cấp**: thêm/sửa/lưu trữ/gộp, danh mục con, tạo nhanh ngay trong ô chọn danh mục; danh mục mặc định có nhóm Thiết yếu / Mong muốn / Tiết kiệm.
- **Giao dịch định kỳ** (ngày/tuần/tháng/năm, mỗi n kỳ, ngày trong tháng, ngày bắt đầu/kết thúc, bật/tắt, bỏ qua kỳ tới): thay thế "lương ngày 1" (rule lương được tạo tự động từ cài đặt cũ), bù kỳ còn thiếu, không sinh lại giao dịch đã xóa.
- **Nhập nhanh**: form 1 màn hình (Chi/Thu/Chuyển), nhớ danh mục & ví dùng gần nhất, chip danh mục hay dùng, gợi ý ghi chú theo danh mục, tag, Enter để lưu tiếp, nút "Lặp lại" trong sheet sửa.
- **Tìm kiếm & lọc**: tìm không dấu (ghi chú, danh mục, ví, tag, số tiền), preset thời gian, lọc nâng cao (loại, ví, danh mục kể cả con, tag, khoảng tiền, khoảng ngày), **bộ lọc đã lưu**, tổng hợp kết quả, xuất CSV theo kết quả lọc.
- **Điều hướng tab dưới cùng** (Trang chủ / Giao dịch / ＋ / Ngân sách / Cài đặt), hash router; Trang chủ có thẻ Ví, Giao dịch gần đây, Định kỳ sắp tới.
- **Dark mode** (theo hệ thống + công tắc), **song ngữ Việt/Anh** (mặc định Việt), test bảo đảm mọi key đều có bản dịch.
- Xuất CSV thêm cột ví / ví đích / tag; sao lưu JSON chứa toàn bộ (ví, danh mục, định kỳ, cài đặt); khôi phục "Gộp" ánh xạ ví/danh mục theo tên.
- Tab Ngân sách: xem trước chi theo danh mục tháng này (P1b sẽ thay bằng ngân sách đầy đủ).

### Sửa
- Service worker: không tự reload trang khi SW được cài lần đầu (chỉ reload khi người dùng bấm "Tải lại").
- Toast/snackbar không bị thanh tab che.

## [2.0.1] — 2026-08-17 — Tinh chỉnh theo Lighthouse (Perf 94/97, A11y 95 → mục tiêu 100)

- A11y: bỏ `aria-label` trên phần tử generic (KPI, chips → `role=group`), cây danh sách đúng cấu trúc `list > listitem` (viewport là `region`, canvas là `list`) — sửa "prohibited ARIA attributes" và "accessibility tree not well-formed".
- CLS: font fallback có `size-adjust/ascent-override` cho Baloo 2, giữ chỗ cho hàng chip danh mục và danh sách; preload + `fetchpriority=high` cho ảnh LCP; logo dùng webp.
- Ghi chú: cảnh báo "cache lifetimes" đến từ header của GitHub Pages (max-age=600), không đổi được từ repo; app đã có service worker precache nên không ảnh hưởng lần mở sau.

## [2.0.0] — 2026-08-17 — P0: sửa 27 lỗi rà soát + tách module

Chi tiết từng lỗi: `docs/P0-review.md`.

### Sửa lỗi — mất dữ liệu
- ID giao dịch dùng `crypto.randomUUID()`; migration cấp lại id cho bản ghi trùng, không mất bản ghi (#1).
- Xóa mềm + **Hoàn tác 5 giây** cho mọi đường xóa (nút ✕, vuốt trái, form sửa) (#2).
- Ghi localStorage có try/catch, ghi song song IndexedDB, cảnh báo khi đầy quota, tự khôi phục từ IndexedDB (#3).
- "Xóa tất cả" xác nhận 2 bước, gợi ý sao lưu JSON ngay trong hộp thoại (#4).
- Thêm Nhập CSV, Sao lưu/Khôi phục JSON (Gộp / Thay thế) (#5).

### Sửa lỗi — số liệu
- Lương định kỳ theo "kỳ còn thiếu" (`lastSalaryPeriod`), bù mọi tháng chưa sinh, không cần mở app đúng mùng 1 (#6).
- Nhận diện lương tự động bằng `source='auto-salary'` + `periodKey`, không dò chuỗi "lương" (#7).
- Parser số tiền hiểu `50k`, `1tr5`, `1.5m`, `2tỷ`, `1tr250k`…; hiển thị số đã hiểu để xác nhận; không hiểu thì báo lỗi (#8).
- Validate số tiền > 0, danh mục không rỗng, ngày hợp lệ (#9).
- Ngày kinh tế lưu dạng `YYYY-MM-DD` giờ địa phương, tách khỏi `createdAt`; không còn lệch múi giờ (#10).
- Tách tier hiển thị khỏi thành tựu; confetti/kỷ lục chỉ tính cho tháng hiện tại khi dữ liệu thật thay đổi (#11).

### Bảo mật
- Bỏ toàn bộ `innerHTML`; render bằng `textContent` — danh mục chứa HTML hiển thị nguyên văn (#12).
- Self-host Chart.js 4.4.7, không còn CDN không ghim version (#13).

### Service worker
- Network-first (timeout 4s) cho HTML/JS/CSS, cache-first cho ảnh/font/vendor; bỏ `ignoreSearch`; không `skipWaiting` tự động, có banner "Có phiên bản mới — Tải lại"; precache đủ Chart.js + font để offline hoàn chỉnh (#14–#17).
- Ngoại lệ 1 lần: khi phát hiện cache SW cũ `expense-cache-*` thì kích hoạt ngay để người dùng cũ nhận bản mới.

### Hiệu năng & kiến trúc
- Chỉ ghi khi dữ liệu đổi; chỉ mục theo tháng memoized; virtual list cho danh sách (10.000 giao dịch tải ~0,25 s) (#18–#20).
- Tách 1 file 1065 dòng thành ES modules `js/{state,storage,migrate}.js`, `js/utils/`, `js/features/`, `js/ui/`, `css/app.css`; 64 unit test + E2E Playwright (#21).

### UX & accessibility
- Bottom sheet sửa giao dịch thay chuỗi `prompt()` (#22).
- Gesture: loại trừ vùng nút, khóa hướng ngang/dọc, `touchmove` không passive chỉ trên danh sách (#23, #24).
- CSV RFC 4180 + BOM UTF-8 (#25).
- ARIA đầy đủ, bẫy focus, Esc đóng modal, mô tả text cho biểu đồ, skip-link, contrast AA, `prefers-reduced-motion` (#26).
- Ghi rõ phạm vi dữ liệu dưới mỗi biểu đồ; nút "Tháng này" (#27).

### Bổ sung ngoài danh sách
- Mascot 192px webp (từ 1,5 MB/ảnh xuống ~10 KB), icon PWA đúng kích thước + maskable, meta iOS PWA.
- Font Baloo 2 / Quicksand self-host, subset Latin + Vietnamese (woff2, giữ trục `wght`).
- Hiển thị phiên bản ở footer; `scripts/bump-version.mjs`; `package.json` với `npm test`.
- Toast lỗi không bị toast thành công đè; bắt `unhandledrejection`.

### Migration
- `mm_transactions_v1` + `mm_settings_v1` → `mm_data_v2` + `mm_settings_v2`. Key cũ giữ nguyên.

## [1.x] — trước 2026-08

- Bản 1 file `index.html`, cache-first SW `expense-cache-v2`, Chart.js CDN.
