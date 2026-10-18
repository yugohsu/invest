# 投資經理人

Beta 再平衡系統（正二 ＋ 現金）的手機入口。

- 網頁入口：GitHub Pages（本儲存庫的 `index.html`）
- 實際運作：Google Apps Script（程式備份在 `gas/` 資料夾）

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `index.html` | GitHub Pages 首頁，嵌入 Apps Script 網頁。換網址只要改 `APP_URL` 那一行 |
| `manifest.webmanifest` | 加到手機桌面時的名稱、圖示、顏色 |
| `icon-192.png`、`icon-512.png`、`apple-touch-icon.png` | App 圖示 |
| `gas/Code.gs`、`gas/Index.html`、`gas/appsscript.json` | Apps Script 程式備份 |

## ⚠️ 安全提醒

`gas/Code.gs` 裡的 `LINE_TOKEN` 和 `WEB_PIN` **不要填真的值再上傳**。
真正的金鑰只填在 Google Apps Script 編輯器裡。
