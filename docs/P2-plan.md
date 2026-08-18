# Kế hoạch P2 — Module C (Phân bổ đầu tư)

> Trạng thái: **đã chốt (18/08/2026)** — Lokan quyết định **bỏ Module D** (tin tức/thị trường qua GitHub Actions). P2 chỉ gồm Module C, hoàn thành ở **v2.6.0**.

## Nguyên tắc bắt buộc
- Chỉ nói về **lớp tài sản** (tiền mặt & thanh khoản, thu nhập cố định, cổ phiếu/quỹ, vàng, bất động sản, khác). **Không bao giờ gợi ý mã** cổ phiếu/quỹ/coin cụ thể (E2E có kiểm tra regex).
- **Disclaimer** hiện cố định đầu mục và trên thẻ trang chủ; bài hồ sơ bắt buộc tick "tôi hiểu đây không phải tư vấn đầu tư" (`settings.invest.acceptedAt`).
- Mọi con số dự phóng là **giả định minh bạch** do người dùng chỉnh được (lợi suất mặc định thận trọng: tiền mặt 2%, cố định 5%, cổ phiếu 8%, vàng 4%, BĐS 5%, khác 0%).
- Ưu tiên **điều kiện tiên quyết**: quỹ khẩn cấp < 3 tháng hoặc nợ lãi ≥ 20%/năm → chặn (⛔); quỹ chưa đủ mục tiêu hoặc nợ ≥ 12% → cảnh báo (⚠️).

## Engine thuần `js/features/allocation.js` (có unit test)
- `QUESTIONS` 6 câu (tuổi, kỳ hạn, thu nhập, phản ứng khi giảm 20%, kinh nghiệm, mục tiêu) có trọng số → `riskScore()` 0–100 → `profileOf()` 5 hồ sơ (thận trọng / ôn hòa / cân bằng / tăng trưởng / năng động).
- `targetAllocation(profile, {horizon})`: bảng gốc theo hồ sơ, kỳ hạn < 2 năm chuyển 60% (2–5 năm: 30%) phần cổ phiếu sang cố định/tiền mặt; luôn tổng 100.
- `currentAllocation(items)` từ `computeNetWorth().items`: ví → tiền mặt; sổ tiết kiệm → cố định; cổ phiếu/quỹ → cổ phiếu; vàng; BĐS; crypto/khác → khác; **bỏ xe và phải thu**.
- `compareAllocation()` → chênh lệch VND/% và hành động (thêm / dư / trong ngưỡng ±5%).
- `prerequisites()`; `suggestMonthly()` = thặng dư TB 3 tháng − phần bồi quỹ khẩn cấp (12 tháng), làm tròn 10k; `dcaPlan()` chia góp theo mục tiêu + dự phóng lãi kép hàng tháng theo lớp, có mốc từng năm.

## UI `js/views/invest.js`
- Tab Ngân sách → mục **Phân bổ đầu tư** (`#/budget?section=invest`): disclaimer → hồ sơ (vòng điểm, mô tả, kỳ hạn, làm lại) → điều kiện tiên quyết → mục tiêu vs hiện tại (thanh + vạch mục tiêu + hành động) → kế hoạch DCA (số tiền/tháng gợi ý, số năm, lợi suất giả định từng lớp, bảng góp/tháng & giá trị cuối, mốc theo năm).
- Thẻ trang chủ `data-card="invest"`: CTA làm bài / hồ sơ + hành động lớn nhất hoặc cảnh báo chặn.
- Lưu ở `settings.invest { answers, score, profile, monthly, years, returns, acceptedAt }`.

## Không làm (theo quyết định)
- Module D: workflow GitHub Actions `data/news.json` / `data/market.json`, thẻ tin tức & thị trường.
