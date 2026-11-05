# Thiết lập đăng nhập TikTok trên máy tính

Dự án có hai kết nối riêng:

- Login Kit xác minh và hiển thị hồ sơ tài khoản trên trang quản trị.
- TikTok LIVE nhận bình luận, tim và quà qua `tiktok-live-connector`. Đăng nhập
  Login Kit không tự cấp quyền nhận sự kiện LIVE hoặc tạo cookie đăng nhập TikTok.

## 1. Tạo Sandbox để thử

Trong trang TikTok for Developers của ứng dụng, chuyển **Production → Sandbox**,
chọn **Create Sandbox**, đặt tên và tạo môi trường thử nghiệm. Sandbox cho phép
thử với các tài khoản đã thêm vào Target users mà chưa cần gửi Production review.

Trong App details, đặt tên `TikTok Live Battle`, chọn nền tảng **Desktop** cho
công cụ chạy tại máy tính. Có thể dùng mô tả:

> Local TikTok LIVE battle dashboard with TikTok account sign-in.

Nếu portal yêu cầu icon, dùng ảnh PNG/JPG 1024 × 1024, tối đa 5 MB.
Các mục Website, Terms of Service và Privacy Policy cần dùng trang thực của bạn
khi được yêu cầu; đây là các URL khác với địa chỉ callback local bên dưới.

## 2. Thêm Login Kit

Vào **Products → Add products → Login Kit**. Bật cấu hình **Desktop** và thêm
Redirect URI chính xác:

```text
http://127.0.0.1:5173/admin
```

Không thêm dấu `/` cuối, query hoặc fragment. Mã hiện tại đã bổ sung PKCE S256
theo định dạng SHA256 hex mà TikTok Desktop yêu cầu, cùng state và mã liên kết
với phiên trình duyệt. Phiên callback dùng một lần, hết hạn sau 10 phút.

Trong **Scopes**, bật **user.info.basic**. Nếu muốn tự lấy @username, thêm quyền
**user.info.profile** rồi cập nhật `TIKTOK_LOGIN_SCOPES` như hướng dẫn bên dưới.
Nếu chỉ có quyền basic, ứng dụng hiện tên và avatar; bạn tự nhập @username ở mục LIVE.

Vào **Sandbox settings → Target users → Add account**. Tự đăng nhập tài khoản
TikTok muốn dùng để thử. Cuối cùng bấm **Apply changes**.

## 3. Cấu hình file .env trên máy

Nếu Client Secret từng được gửi vào chat hoặc lộ trong ảnh, bấm **Reset** để lấy
secret mới. Lấy key và secret từ đúng môi trường Sandbox đang sử dụng; không gửi
secret vào chat, không đặt trong `client/.env` hoặc biến có tiền tố `VITE_`.

Mở `D:\tiktok-live-battle\.env` và điền trực tiếp trên máy:

```dotenv
TIKTOK_CLIENT_KEY=CLIENT_KEY_CUA_SANDBOX
TIKTOK_CLIENT_SECRET=CLIENT_SECRET_MOI_CUA_SANDBOX
TIKTOK_LOGIN_PLATFORM=desktop
TIKTOK_LOGIN_SCOPES=user.info.basic
TIKTOK_REDIRECT_URI=http://127.0.0.1:5173/admin
```

Nếu Sandbox đã cho phép quyền profile, có thể dùng:

```dotenv
TIKTOK_LOGIN_SCOPES=user.info.basic,user.info.profile
```

## 4. Khởi động và đăng nhập

Sau khi thay `.env`, dừng terminal server cũ bằng Ctrl+C rồi chạy lại
`pnpm dev:server`. Mở frontend bằng `pnpm dev:client` nếu chưa chạy.

Mở **http://127.0.0.1:5173/admin**, bấm **Đăng nhập bằng TikTok**, và tự hoàn
thành đăng nhập/cấp quyền trên trang TikTok. Nếu bắt đầu ở localhost hoặc địa chỉ
LAN, nút đăng nhập tự chuyển về đúng origin callback rồi tạo phiên mới trước khi
mở TikTok. Mỗi lần đăng nhập có mã riêng, được lưu tối đa 10 phút và có thể nhận
callback ở tab khác trong cùng trình duyệt. Sau khi cập nhật mã, tải lại trang
bằng Ctrl+F5 và bắt đầu lại từ nút đăng nhập; URL callback cũ không tái sử dụng được.

Đây là xác minh hồ sơ tài khoản; các API quản trị hiện chưa được khóa bằng phiên OAuth.

## Lỗi thường gặp

- `redirect_uri`: URI trên portal và trong `.env` phải giống hoàn toàn; chọn Desktop
  cho callback HTTP local. Login Kit Web yêu cầu HTTPS.
- `invalid_client`: đối chiếu key và secret của cùng Sandbox; dùng secret mới sau Reset.
- `scope_not_authorized` / `invalid_scope`: scopes trong `.env` phải được bật trên portal.
- `Phiên đăng nhập không khớp`: mở đúng địa chỉ 127.0.0.1 đã cấu hình và bắt đầu lại
  bằng nút đăng nhập; không dán URL callback từ trình duyệt khác.
- `Failed to retrieve Room ID`: lỗi kết nối LIVE riêng; kiểm tra đúng @username và
  tài khoản đang phát LIVE. Login Kit không tự giải quyết lỗi lấy phòng LIVE.

Tài liệu chính thức:

- https://developers.tiktok.com/docs/en/add-a-sandbox
- https://developers.tiktok.com/docs/en/login-kit-desktop
- https://developers.tiktok.com/docs/en/login-kit-web
- https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info
