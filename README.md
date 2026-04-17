# TaiXiu Psychology Analyzer

## Deploy Railway (3 bước)

1. Push code lên GitHub
2. Vào [railway.app](https://railway.app) → New Project → Deploy from GitHub → chọn repo
3. Xong — Railway tự build và chạy, cấp domain HTTPS luôn

## Chạy local

```bash
npm install
npm start
# http://localhost:3000
```

## Endpoints

| Path | Mô tả |
|------|-------|
| `GET /` | Giao diện chính |
| `GET /health` | Trạng thái server |
| `GET /live` | SSE real-time tick |
| `GET /live-snapshot` | Snapshot hiện tại |
| `GET /result` | Kết quả phiên mới nhất |
| `GET /history?limit=50` | Lịch sử kết quả |
| `GET /analyze-predictions` | Kết luận AI |
| `GET /predictions-log` | Xem log dự đoán |
| `DELETE /predictions-log` | Xóa log |
| `GET /token-status` | Trạng thái token |
| `POST /update-token` | Cập nhật token |
