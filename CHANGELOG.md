# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.0.0/). Phiên bản = `APP_VERSION` = `CACHE_VERSION`.

## [2.6.0] — 2026-08-18 — P2 Module C: phân bổ đầu tư theo lớp tài sản (không gợi ý mã, có disclaimer)

### Thêm
- **Hồ sơ rủi ro** 6 câu (tuổi, kỳ hạn, thu nhập, phản ứng khi danh mục giảm 20%, kinh nghiệm, mục tiêu) → điểm 0–100 → 5 hồ sơ (Thận trọng / Ôn hòa / Cân bằng / Tăng trưởng / Năng động); bắt buộc xác nhận "không phải tư vấn đầu tư".
- **Phân bổ mục tiêu theo lớp tài sản** (tiền mặt & thanh khoản, thu nhập cố định, cổ phiếu/quỹ, vàng, bất động sản, khác) theo hồ sơ, tự giảm cổ phiếu khi kỳ hạn ngắn; **so với phân bổ hiện tại** tính từ Tài sản ròng (ví → tiền mặt, sổ tiết kiệm → cố định, cổ phiếu/quỹ, vàng, BĐS, crypto; bỏ xe và phải thu) → chênh lệch VND, hành động "cần thêm / đang dư / trong ngưỡng ±5%", gợi ý tái cân bằng bằng tiền góp mới.
- **Điều kiện tiên quyết**: quỹ khẩn cấp < 3 tháng hoặc nợ lãi ≥ 20%/năm → chặn; chưa đủ mục tiêu quỹ hoặc nợ ≥ 12% → cảnh báo.
- **Kế hoạch góp đều (DCA)**: gợi ý số tiền/tháng từ thặng dư TB 3 tháng trừ phần bồi quỹ khẩn cấp; chia theo lớp; **dự phóng** lãi kép theo lợi suất giả định người dùng tự đặt (mặc định thận trọng), mốc theo năm; disclaimer riêng.
- Thẻ **Phân bổ đầu tư** ở Trang chủ (CTA / hồ sơ + hành động lớn nhất / cảnh báo chặn); mục mới trong tab Ngân sách (`#/budget?section=invest`).
- Unit test engine phân bổ (điểm/hồ sơ, mục tiêu tổng 100 & glide theo kỳ hạn, phân bổ hiện tại, so sánh, điều kiện tiên quyết, DCA, gợi ý số tiền) — 113 test tổng; E2E +7 kiểm tra (gồm kiểm tra không có mã cổ phiếu/quỹ/coin trong nội dung).

### Ghi chú
- **Module D (tin tức/thị trường qua GitHub Actions) đã được bỏ** theo quyết định của chủ dự án — xem `docs/P2-plan.md`.

## [2.5.0] — 2026-08-18 — P1d-2: wizard nhập CSV/Excel + mẫu sao kê ngân hàng VN, khóa PIN & mã hóa dữ liệu

### Thêm
- **Wizard nhập CSV/Excel 3 bước** (Cài đặt → Dữ liệu → Nhập CSV / Excel): (1) chọn sheet, **tự dò dòng tiêu đề** (sao kê thường có vài dòng thông tin trước bảng), **nhận dạng mẫu** — Vietcombank, Techcombank, MB, BIDV, VPBank, TPBank, ACB, MoMo, Money Lover, CSV của app; (2) **ánh xạ cột** (ngày, số tiền một cột ± hoặc hai cột ghi nợ/ghi có, nội dung, danh mục, loại, ví, mã giao dịch), định dạng ngày (tự dò d/m/y, m/d/y, y-m-d, Excel serial), ví nhập vào, **tự gán danh mục theo nội dung** (từ khóa VN: GRAB → Đi lại, SHOPEE → Mua sắm, EVN → Hóa đơn, NETFLIX → Giải trí… + **học từ giao dịch cũ**), **lưu ánh xạ thành mẫu** dùng lại; (3) xem trước, đếm trùng (theo mã giao dịch / vân tay), nhập. Số tiền hiểu mọi kiểu `1,250,000` / `1.250.000` / `1.250.000,50` / `(500)` / `-500.000`.
- **Đọc file Excel** (.xlsx/.xls/.ods) bằng SheetJS mini (Apache-2.0) tự lưu trữ trong `vendor/`, nạp lười khi cần, có trong precache.
- **Khóa PIN & mã hóa dữ liệu** (Cài đặt → Bảo mật): PIN 4–8 số → khóa AES-GCM-256 ngẫu nhiên bọc bằng PBKDF2-SHA256 (210k vòng) từ PIN và từ **mã khôi phục** 20 ký tự (hiện một lần, bắt buộc xác nhận đã lưu); toàn bộ `mm_data_v3` (localStorage + IndexedDB) trở thành envelope mã hóa — sai PIN không lộ gì; **màn hình khóa** khi mở app (nội dung phía sau chưa tải), chặn 30 giây sau 5 lần sai, mở bằng mã khôi phục khi quên PIN; **tự khóa** khi rời app 1/5/15/60 phút và nút 🔒 khóa ngay; đổi PIN, tạo mã khôi phục mới, tắt mã hóa (cần PIN). Bật mã hóa xóa bản sao dữ liệu cũ dạng thường (`mm_transactions_v1`, `mm_data_v2`). Sao lưu JSON luôn ở dạng thường (ghi rõ trong UI).
- Unit test wizard (parse số/ngày, dò tiêu đề, preset VCB, Money Lover, cột loại, gán danh mục) và crypto (mở bằng PIN/mã khôi phục, sai PIN, đổi PIN, đổi mã) — 107 test tổng; E2E +11 kiểm tra (wizard với sao kê VCB mẫu `tests/fixtures-vcb.csv`, bật/khóa/mở/đổi/tắt mã hóa).

### Sửa
- Onboarding: đóng sheet bước 1 bằng ✕ giờ kết thúc onboarding thay vì nhảy sang bước 2; sheet đóng trước khi mở bước kế (tránh đóng nhầm sheet mới).

## [2.4.0] — 2026-08-17 — P1d-1: công nợ cá nhân, ảnh hóa đơn, onboarding 60 giây

### Thêm
- **Công nợ cá nhân (cho mượn / đi mượn)**: mỗi khoản là một **giao dịch thật** trên ví gắn meta `debt {kind, person}` (danh mục hệ thống "Cho mượn", "Đi mượn", "Thu nợ", "Trả nợ vay" tự tạo); màn hình tổng hợp theo người (số dư dương = họ nợ bạn, âm = bạn nợ họ), lịch sử, ghi trả/thu nợ (điền sẵn số còn lại), gợi ý tên người đã có; phải thu tính vào **tài sản**, phải trả vào **nợ** ở Tài sản ròng; dòng tóm tắt ở thẻ Ví trang chủ; huy hiệu 🤝 trên dòng giao dịch.
- **Ảnh hóa đơn**: chụp/chọn ảnh ở form thêm nhanh và sheet sửa → nén bằng canvas (cạnh dài ≤ 1280 px, ≤ ~250 KB, JPEG, giữ hướng EXIF) → lưu **IndexedDB store `blobs`** theo id giao dịch (không phình localStorage); thumbnail, xem lớn (lightbox, Esc để đóng), gỡ ảnh; 📎 trên dòng giao dịch; ảnh bị xóa khi giao dịch bị xóa hẳn / xóa tất cả; **sao lưu JSON có tùy chọn kèm ảnh** (base64) và khôi phục lại ảnh (thay thế hoặc gộp).
- **Onboarding 60 giây** cho người mới (chưa có giao dịch): 3 bước — ví chính & số dư (+ tài khoản ngân hàng tùy chọn) → lương/thu nhập định kỳ (tạo rule tháng, sinh ngay kỳ tháng này) → ngân sách tổng tháng (gợi ý 80% thu nhập); bỏ qua được; người dùng cũ tự đánh dấu đã qua.
- Unit test công nợ / tài sản ròng / sao lưu kèm ảnh (98 test tổng); E2E bổ sung 8 kiểm tra (onboarding, công nợ, ảnh hóa đơn); IndexedDB nâng version 2 (thêm store `blobs`, giữ nguyên `kv`).

## [2.3.0] — 2026-08-17 — P1c: quản lý nợ, tài sản ròng, dự báo dòng tiền, điểm sức khỏe, streak & huy hiệu, biểu đồ mới

### Thêm
- **Quản lý nợ**: khoản vay/trả góp/dư nợ thẻ (gốc, lãi %/năm, kỳ hạn, ngày giải ngân, ngày trả) → **lịch trả nợ niên kim** đầy đủ (kỳ, ngày, trả, lãi, gốc, dư nợ), trạng thái tới hôm nay (còn nợ, đã trả, kỳ tới), **ghi khoản trả thêm** (rút ngắn lịch), mô phỏng "nếu trả thêm X/tháng → xong sớm N tháng, tiết kiệm Y lãi", so sánh **snowball vs avalanche** với ngân sách thêm mỗi tháng.
- **Tài sản ròng**: ví trong app tự tính + khai báo tài sản/nợ ngoài app (tiết kiệm, cổ phiếu, quỹ/ETF, vàng, bất động sản, xe, crypto, khác) + dư nợ các khoản vay → Tài sản / Nợ / Ròng; **snapshot mỗi tháng** (tự lưu, chỉ ghi khi đổi) và biểu đồ 24 tháng.
- **Dự báo dòng tiền 3/6/12 tháng**: thu/chi định kỳ + TB thu/chi khác 3 tháng gần nhất + trả nợ đến hạn; đánh dấu tháng dự báo âm; ghi rõ giả định.
- **Điểm sức khỏe tài chính 0–100 minh bạch**: 5 thành phần (tỉ lệ tiết kiệm 25, quỹ khẩn cấp 25, DTI 20, độ ổn định chi tiêu 15, đa dạng hóa tài sản 15) — mỗi thành phần hiện giá trị thật, điểm đạt/trọng số và gợi ý cải thiện; **trọng số tùy chỉnh** (tự chuẩn hóa); tier sức khỏe 0–4 (Cần cấp cứu → Xuất sắc).
- **Streak ghi chép** (chuỗi ngày liên tục có giao dịch tay, bỏ qua tự sinh) và **11 huy hiệu** (giao dịch đầu tiên, 100/1.000 giao dịch, chuỗi 7/30 ngày, ngân sách đầu tiên, hoàn thành mục tiêu, quỹ 3/6 tháng, sức khỏe ≥ 70, 3 tháng liên tiếp thu ≥ chi) — toast khi mở khóa, lưu trong cài đặt.
- Thẻ **Điểm sức khỏe** ở Trang chủ (vòng điểm, 5 thanh, chuỗi, huy hiệu) → "Chi tiết" mở tab Ngân sách; các mục mới trong tab Ngân sách (`#/budget?section=health|debts|networth|forecast`).
- **Biểu đồ mới**: dòng tiền tích lũy theo ngày trong tháng, so sánh chi theo danh mục gốc với tháng trước, **heatmap chi theo ngày** (lưới lịch, không cần Chart.js; có mô tả cho trình đọc màn hình).
- Unit test cho lịch trả nợ / snowball–avalanche / trả sớm, tài sản ròng & snapshot & đa dạng hóa, dự báo, điểm sức khỏe & tier, streak & huy hiệu (93 test tổng); E2E bổ sung 15 kiểm tra; precache SW cập nhật (67 file).

### Sửa
- Streak bỏ qua giao dịch có thời điểm tạo trong tương lai (lệch giờ máy).

## [2.2.0] — 2026-08-17 — P1b: ngân sách, 50/30/20, quỹ khẩn cấp, mục tiêu tiết kiệm, insight, sắp xếp thẻ

### Thêm
- **Ngân sách theo danh mục** (hoặc tổng chi tháng): thanh tiến độ xanh/vàng/đỏ (80% / 100%), số còn lại, gợi ý mức chi/ngày cho các ngày còn lại, so sánh với **trung bình 3 tháng trước** (chỉ tính tháng có ghi chép); ngân sách gắn danh mục cha gồm cả con; cảnh báo hiện ở Trang chủ.
- **Quy tắc 50/30/20**: tỉ lệ thực tế Thiết yếu / Mong muốn / Tiết kiệm–Đầu tư trên thu nhập tháng đang xem (phần thu nhập chưa chi cũng là tiết kiệm), vạch mục tiêu, chỉnh tỉ trọng, xếp nhanh nhóm cho danh mục chưa phân loại.
- **Quỹ khẩn cấp**: chi thiết yếu TB 6 tháng gần nhất → mục tiêu 3/6/12 tháng; quỹ = ví được chọn + tiền giữ ngoài app; trạng thái đỏ/vàng/xanh; cảnh báo khi dành > 20% thu nhập cho đầu tư mà quỹ chưa đủ 3 tháng.
- **Mục tiêu tiết kiệm (sinking funds)**: tên, icon, số tiền, hạn → "cần X/tháng", tiến độ, ghi nhận khoản để dành (lịch sử, xóa từng khoản), quá hạn/hoàn thành.
- **Insight tự động**: tỉ lệ tiết kiệm, danh mục tăng ≥ 30% so TB 3 tháng, top 5 khoản chi, chi phí định kỳ / thu nhập, khoản lặp lại 3 tháng liền (nghi subscription).
- **Trang chủ dạng thẻ sắp xếp được** (kéo-thả trên desktop, nút ▲▼ trên mọi thiết bị, lưu thứ tự); thêm thẻ Insight, Ngân sách tháng, Mục tiêu.
- Unit test cho ngân sách, 50/30/20, quỹ khẩn cấp, mục tiêu, insight (83 test tổng); E2E bổ sung.

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
