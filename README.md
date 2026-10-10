# 分頁影音錄影機

Chrome 116+ 擴充功能：指定分頁影音錄製、獨立繁體中文控制視窗、本機儲存與可設定更新來源。

## 下載與安裝

Windows 10／11：到 [GitHub Releases](https://github.com/wuwu50/chrome-tab-recorder/releases/latest) 下載 `ChromeTabRecorder-版本-Setup.exe`。安裝後開啟桌面或開始功能表捷徑，使用引導介面開啟 Chrome、複製擴充功能資料夾路徑，完成「載入未封裝項目」。不需要系統管理員權限。

EXE 負責安裝檔案、建立捷徑與引導 Chrome 啟用；影音錄製仍由 Chrome 擴充功能執行。第一次啟用與升級後重新載入需要使用者操作。解除安裝前，先在 Chrome 移除擴充功能。

也保留 ZIP 手動安裝：解壓縮，在 chrome://extensions 開啟開發人員模式，載入包含 manifest.json 的資料夾。

在目標網頁點擴充功能圖示 → 開啟獨立控制視窗 → 開始錄影。背景錄影不擷取其他程式、其他分頁或麥克風音訊。最小化後畫面是否持續更新仍取決於網站與 Chrome，請先短錄驗證。

完整操作與限制請看 [使用說明](extension/使用說明.md)。錄影 UI 是獨立 Chrome 控制視窗，安裝引導則是原生 Windows 視窗。

## 程式內更新

v1.6.0 的 Windows EXE 安裝版支援確認後自動下載安裝。桌面捷徑開啟的視窗按「檢查更新並安裝」，或從 Chrome 錄影控制視窗按「確認更新並自動安裝」。會自動使用原本安裝目錄；不需要選擇下載檔案位置。更新先驗證官方安裝包 SHA-256，再啟動只有進度畫面的安裝流程。下載失敗或驗證不符不執行安裝，保留原版。

舊版需先手動安裝 v1.6.0 一次。請先停止錄影並儲存；安裝後 Chrome 擴充功能仍需重新載入。ZIP 版沒有註冊 Windows 更新器，請使用 EXE 安裝版。

首次 Release 成功後，Actions 會在 main 分支建立 `version.json`。程式預設已設定此來源：

`https://raw.githubusercontent.com/wuwu50/chrome-tab-recorder/main/version.json`

按「檢查更新」並允許 Chrome 連線即可。EXE 安裝版確認更新後自動安裝；ZIP 版手動替換。安裝後重新載入；更新前先停止錄影並儲存。原先已手動設定或清空的來源會保留；必要時在「設定更新來源」改回上方網址。

## 自動發布

把此資料夾內容上傳到專用儲存庫的 main 分支；`.github/workflows/release.yml` 會測試、產生 ZIP、發布 Release，最後寫入線上版本資訊。只有 Release 建立成功後才發布 version.json。

後续修改需提高 `extension/manifest.json` 的版本，並更新 `RELEASE_NOTES.md`。相同版本不覆蓋既有 Release；若發布失敗，請先查 Actions 的錯誤，再處理。

## 本機驗證

需要 Node.js 24，不需安裝 npm 依賴：

```
node tests/test-recorder.cjs
node tests/test-updates.cjs
```

這些是模擬流程測試；不代表已驗證所有網站的實際影音與最小化行為。

## 長時間錄影與中斷取回

v1.7.0 逐段保存錄影、限制待寫入資料並檢查估計暫存配額。重新開啟控制視窗可嘗試儲存未完成的片段；不保證意外中斷的 MP4 可播放，也無法保證取回舊版暫存。120 FPS 仍可選；長錄建議先測試 60 FPS。遇到問題請按「匯出錯誤紀錄」。詳見使用說明。
