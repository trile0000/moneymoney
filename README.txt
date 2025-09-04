# Quản Lý Chi Tiêu (PWA – Offline)

App PWA chạy *hoàn toàn offline* (sau lần mở đầu tiên) và có thể **Add to Home Screen** trên iPhone như ứng dụng native.

## Cấu trúc
- `index.html`: giao diện + logic, pie chart canvas (không phụ thuộc thư viện ngoài).
- `manifest.json`: tên app, theme, icon.
- `service-worker.js`: cache offline.
- `assets/icon-192.png`, `assets/icon-512.png`, `assets/apple-touch-icon.png`: icon iOS.

## Cài đặt lên iPhone (khuyến nghị Netlify)
1. Vào https://app.netlify.com/drop (yêu cầu đăng nhập).
2. Kéo thả **toàn bộ thư mục** này (hoặc file ZIP) lên để deploy.
3. Mở domain mà Netlify cung cấp (HTTPS).
4. Trên iPhone mở bằng **Safari** → **Share** → **Add to Home Screen** → **Add**.
5. Từ giờ app sẽ chạy offline.

> Lưu ý: iOS chỉ cho Service Worker hoạt động trên **HTTPS** (hoặc `localhost`). Vì vậy cần deploy HTTPS (Netlify, Vercel, GitHub Pages).

## Nâng cấp / cập nhật app
- Sửa mã → upload lại → Netlify tự cập nhật.
- iPhone sẽ nhận bản mới khi bạn mở lại app (do SW update).

## Sao lưu dữ liệu
- Dữ liệu được lưu trong `localStorage` của trình duyệt trên iPhone.
- Để sao lưu, bạn có thể dùng iCloud backup của Safari/Web App hoặc xuất CSV (tính năng có thể thêm sau).

Chúc bạn quản lý chi tiêu hiệu quả!