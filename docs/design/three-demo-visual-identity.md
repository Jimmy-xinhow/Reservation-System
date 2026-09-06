# 三個 DEMO 品牌視覺識別與頁面規則

**整理日期：** 2026-09-07  
**適用範圍：** `demo-beauty`、`demo-course`、`demo-pilates` 公開形象頁  
**參照方法：** 以 `visual-brand-extractor` 拆解市場頁面的資訊層次、字體角色、按鈕語法與版面節奏，再依本產品現有品牌內容重組；不複製任一競品版面。

## 市場觀察

- 美業頁面最重要的是「信任 → 療程資訊 → 可預約入口」，療程名稱、適合對象與預約動作不應被藏在裝飾性卡片後面。參照：[Aesthera Studio](https://aestherastudio.com/)、[FrontDesk Med Spa](https://frontdesk.care/med-spa-website-design)。
- 課程頁面需要先回答學什麼、怎麼學、何時開始與報名後去哪裡，課綱式結構比一般商品卡更容易掃讀。參照：[Designlab UX Academy](https://designlab.com/ux-academy)、[Cohort](https://cohort.framer.media/)。
- 皮拉提斯頁面的主要任務是看懂課型、教室節奏與可用場次，首屏影像和課表入口必須直接。參照：[Nouva Pilates](https://nouvapilates.com/)、[Reform Modern Pilates](https://reformmodernpilates.com/)。
- SaaS 市場頁面常用真實情境、明確模組與可驗證成果建立信任；本頁只吸收資訊策略，不採用其卡片式產品頁外觀。參照：[C360+](https://www.c360plus.com/)、[WishMobile](https://www.wishmobile.com/plan)。

## 共通禁用規則

- 不共用「Hero → 三張賣點卡 → 卡片清單 → 關於 → 大 CTA」模板。
- 不使用紫色漸層、玻璃卡片、漂浮光球、膠囊標籤群或大量圓角。
- 不用「了解更多」等模糊按鈕；按鈕直接說明動作與結果。
- 不以陰影代替層次；主要使用留白、排版、細線與圖像裁切建立結構。
- 不虛構評價、證照、學員人數、療效、課程成果或即時名額。
- 手機版首屏必須同時看見品牌、主訊息與可執行按鈕，不把操作藏在選單內。

## ÉLAN 肌膚美學所

**視覺語氣：** 安靜、專業、帶有紙本療程目錄的編輯感。  
**記憶點：** 大幅不對稱影像、療程索引表、赭紅色垂直標記。

```css
:root {
  --elan-paper: #f1eee6;
  --elan-sheet: #fbf8f1;
  --elan-ink: #242522;
  --elan-muted: #6f6a62;
  --elan-rust: #914b3d;
  --elan-line: #cfc8bc;
}
```

- 標題：`Noto Serif TC` / `Songti TC`，500。
- 內文：`Noto Sans TC` / `Microsoft JhengHei`，400–600。
- 主要按鈕：直角、赭紅底、右側長箭頭；動詞使用「查看療程與時段」。
- 次要按鈕：無底色、只有底線與箭頭。
- 圓角：圖片與容器 0–2px；不使用陰影。
- 內容順序：品牌立場 → 三項服務承諾 → 療程索引 → 照護方法 → 預約。

## OPENROOM 學習所

**視覺語氣：** 獨立刊物、課綱、理性但不冰冷。  
**記憶點：** 藍色課程編號、頁碼式資訊欄、像 syllabus 的課程列。

```css
:root {
  --openroom-paper: #eef2f4;
  --openroom-sheet: #faf9f5;
  --openroom-ink: #132238;
  --openroom-blue: #155e9b;
  --openroom-red: #d34c3f;
  --openroom-line: #aeb9c3;
}
```

- 標題：`Arial Narrow` / `Noto Sans TC`，700，緊縮字距。
- 內文：`Noto Sans TC`，400–600。
- 主要按鈕：藍色方形按鈕，包含「探索課程」與方向箭頭。
- 次要按鈕：文字連結配紅色編號，不使用外框卡片。
- 圓角：0；圖片可用 1px 細框與錯位色塊。
- 內容順序：學習主張 → 本期內容索引 → 學習方式 → 課後入口 → 常見問題。

## FORME 皮拉提斯

**視覺語氣：** 建築感、克制、具身體動態與教室節奏。  
**記憶點：** 全版深綠攝影、黃褐色課表線、橫向時段板。

```css
:root {
  --forme-night: #0d1917;
  --forme-green: #18312d;
  --forme-cream: #e8e8dc;
  --forme-ochre: #d0a43a;
  --forme-mist: #9ea9a4;
  --forme-line: #3f514d;
}
```

- 標題：`Arial Black` / `Noto Sans TC`，700–800；英文字重、中文留白。
- 內文：`Noto Sans TC`，400–600。
- 主要按鈕：黃褐色實心、深色文字；文字使用「預約第一堂課」。
- 課表列：深綠底、細線分隔、右側明確「查看時段／查看場次」。
- 圓角：0；不使用陰影。
- 內容順序：教室氣氛與行動 → 課表 → 三項訓練原則 → 空間與適合對象 → 預約。

## 手機版驗收規則

- 390px 寬度下不得橫向捲動。
- 首屏 720px 高度內看見主標、簡述、主要行動與至少一部分品牌照片。
- 觸控按鈕高度至少 48px，固定操作列不遮住頁尾內容。
- 服務／課程列在窄螢幕改為兩層資訊，但動作仍需直接可見。
- 圖片不得只剩牆面或背景；人物與服務動作應保留在主要裁切區。

## Brand Config

```json
{
  "elan": {
    "primary_color": "#914b3d",
    "background": "#f1eee6",
    "text_color": "#242522",
    "font_heading": "Noto Serif TC",
    "font_body": "Noto Sans TC"
  },
  "openroom": {
    "primary_color": "#155e9b",
    "secondary_color": "#d34c3f",
    "background": "#eef2f4",
    "text_color": "#132238",
    "font_heading": "Arial Narrow, Noto Sans TC",
    "font_body": "Noto Sans TC"
  },
  "forme": {
    "primary_color": "#d0a43a",
    "background": "#0d1917",
    "text_color": "#e8e8dc",
    "font_heading": "Arial Black, Noto Sans TC",
    "font_body": "Noto Sans TC"
  }
}
```
