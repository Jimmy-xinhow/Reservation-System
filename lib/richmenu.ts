// Rich Menu 版型與動作 → LINE areas 計算。

export type Layout = "full-3" | "full-6" | "compact-2" | "compact-3";

export interface LayoutSpec {
  label: string;
  width: number;
  height: number;
  cols: number;
  rows: number;
  slots: number;
}

export const LAYOUTS: Record<Layout, LayoutSpec> = {
  "full-3": { label: "完整・3 格(橫排)", width: 2500, height: 1686, cols: 3, rows: 1, slots: 3 },
  "full-6": { label: "完整・6 格(2 排×3)", width: 2500, height: 1686, cols: 3, rows: 2, slots: 6 },
  "compact-2": { label: "精簡・2 格", width: 2500, height: 843, cols: 2, rows: 1, slots: 2 },
  "compact-3": { label: "精簡・3 格", width: 2500, height: 843, cols: 3, rows: 1, slots: 3 },
};

export interface Slot {
  label: string;
  action: "booking" | "query" | "progress" | "info" | "uri" | "text" | "none";
  value?: string; // uri/text 用
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 依版型算出每一格的方框(填滿整張圖,末格補齊餘數)。 */
export function slotBounds(layout: Layout): Bounds[] {
  const spec = LAYOUTS[layout];
  const cellW = Math.floor(spec.width / spec.cols);
  const cellH = Math.floor(spec.height / spec.rows);
  const out: Bounds[] = [];
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      const isLastCol = c === spec.cols - 1;
      const isLastRow = r === spec.rows - 1;
      out.push({
        x: c * cellW,
        y: r * cellH,
        width: isLastCol ? spec.width - c * cellW : cellW,
        height: isLastRow ? spec.height - r * cellH : cellH,
      });
    }
  }
  return out;
}

/** 把一格的動作轉成 LINE action 物件。label 空白則省略(LINE 不接受空字串 label)。 */
export function slotAction(
  slot: Slot,
  liffUrl: string | null,
  baseUrl: string,
): Record<string, unknown> | null {
  const lbl = (slot.label ?? "").trim();
  const withLabel = (a: Record<string, unknown>) => (lbl ? { ...a, label: lbl } : a);
  switch (slot.action) {
    case "booking":
      return withLabel(liffUrl ? { type: "uri", uri: liffUrl } : { type: "message", text: "預約" });
    case "query":
      return withLabel({ type: "message", text: "查詢" });
    case "progress":
      return withLabel({ type: "message", text: "進度" });
    case "info":
      return baseUrl ? withLabel({ type: "uri", uri: baseUrl }) : null;
    case "uri":
      return slot.value ? withLabel({ type: "uri", uri: slot.value }) : null;
    case "text":
      return slot.value ? withLabel({ type: "message", text: slot.value }) : null;
    default:
      return null;
  }
}

export const ACTION_OPTIONS: { value: Slot["action"]; label: string }[] = [
  { value: "booking", label: "立即預約" },
  { value: "query", label: "查詢預約" },
  { value: "progress", label: "看診進度" },
  { value: "info", label: "診所資訊" },
  { value: "uri", label: "自訂連結" },
  { value: "text", label: "送出文字" },
  { value: "none", label: "(不設定)" },
];
