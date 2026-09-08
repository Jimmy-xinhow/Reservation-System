import "server-only";

import sharp from "sharp";
import path from "node:path";
import { LAYOUTS, RICH_MENU_TEMPLATES, richMenuIconForAction, slotBounds, type BuiltInRichMenuTemplateKey, type Layout, type RichMenuIconKey, type Slot } from "@/lib/richmenu";

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function icon(iconKey: RichMenuIconKey, x: number, y: number, size: number, stroke: string): string {
  const sw = Math.max(9, Math.round(size * 0.052));
  const common = `fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  const unit = size / 100;
  switch (iconKey) {
    case "calendar": return `<g ${common}><rect x="${x + 14 * unit}" y="${y + 20 * unit}" width="${72 * unit}" height="${66 * unit}" rx="${10 * unit}"/><path d="M${x + 14 * unit} ${y + 40 * unit}h${72 * unit}M${x + 32 * unit} ${y + 12 * unit}v${17 * unit}M${x + 68 * unit} ${y + 12 * unit}v${17 * unit}M${x + 34 * unit} ${y + 62 * unit}l${10 * unit} ${10 * unit} ${23 * unit}-${25 * unit}"/></g>`;
    case "clock": return `<g ${common}><circle cx="${x + 50 * unit}" cy="${y + 50 * unit}" r="${35 * unit}"/><path d="M${x + 50 * unit} ${y + 29 * unit}v${23 * unit}l${17 * unit} ${10 * unit}"/></g>`;
    case "book": return `<g ${common}><path d="M${x + 14 * unit} ${y + 22 * unit}h${25 * unit}c${8 * unit} 0 ${11 * unit} ${5 * unit} ${11 * unit} ${12 * unit}v${52 * unit}c0-${8 * unit}-${7 * unit}-${12 * unit}-${16 * unit}-${12 * unit}H${x + 14 * unit}zM${x + 86 * unit} ${y + 22 * unit}H${x + 61 * unit}c-${8 * unit} 0-${11 * unit} ${5 * unit}-${11 * unit} ${12 * unit}v${52 * unit}c0-${8 * unit} ${7 * unit}-${12 * unit} ${16 * unit}-${12 * unit}h${20 * unit}z"/></g>`;
    case "ticket": return `<g ${common}><rect x="${x + 14 * unit}" y="${y + 27 * unit}" width="${72 * unit}" height="${58 * unit}" rx="${9 * unit}"/><path d="M${x + 57 * unit} ${y + 27 * unit}v${10 * unit}m0 ${10 * unit}v${12 * unit}m0 ${10 * unit}v${16 * unit}M${x + 28 * unit} ${y + 50 * unit}h${17 * unit}M${x + 28 * unit} ${y + 64 * unit}h${13 * unit}"/></g>`;
    case "heart": return `<g ${common}><path d="M${x + 50 * unit} ${y + 86 * unit}C${x + 18 * unit} ${y + 68 * unit},${x + 12 * unit} ${y + 48 * unit},${x + 20 * unit} ${y + 32 * unit}C${x + 29 * unit} ${y + 15 * unit},${x + 47 * unit} ${y + 22 * unit},${x + 50 * unit} ${y + 35 * unit}C${x + 53 * unit} ${y + 22 * unit},${x + 71 * unit} ${y + 15 * unit},${x + 80 * unit} ${y + 32 * unit}C${x + 88 * unit} ${y + 48 * unit},${x + 82 * unit} ${y + 68 * unit},${x + 50 * unit} ${y + 86 * unit}z"/></g>`;
    case "chat": return `<g ${common}><path d="M${x + 16 * unit} ${y + 20 * unit}h${68 * unit}v${50 * unit}H${x + 48 * unit}L${x + 29 * unit} ${y + 86 * unit}l${4 * unit}-${16 * unit}H${x + 16 * unit}z"/><path d="M${x + 34 * unit} ${y + 45 * unit}h${32 * unit}M${x + 34 * unit} ${y + 58 * unit}h${21 * unit}"/></g>`;
    case "profile": return `<g ${common}><circle cx="${x + 50 * unit}" cy="${y + 34 * unit}" r="${18 * unit}"/><path d="M${x + 18 * unit} ${y + 86 * unit}c${5 * unit}-${28 * unit} ${18 * unit}-${38 * unit} ${32 * unit}-${38 * unit}s${27 * unit} ${10 * unit} ${32 * unit} ${38 * unit}"/></g>`;
    case "sparkles": return `<g ${common}><path d="M${x + 50 * unit} ${y + 12 * unit}c${3 * unit} ${20 * unit} ${12 * unit} ${29 * unit} ${31 * unit} ${33 * unit}-${19 * unit} ${4 * unit}-${28 * unit} ${13 * unit}-${31 * unit} ${33 * unit}-${3 * unit}-${20 * unit}-${12 * unit}-${29 * unit}-${31 * unit}-${33 * unit} ${19 * unit}-${4 * unit} ${28 * unit}-${13 * unit} ${31 * unit}-${33 * unit}zM${x + 24 * unit} ${y + 17 * unit}v${18 * unit}M${x + 15 * unit} ${y + 26 * unit}h${18 * unit}M${x + 77 * unit} ${y + 67 * unit}v${16 * unit}M${x + 69 * unit} ${y + 75 * unit}h${16 * unit}"/></g>`;
    case "bag": return `<g ${common}><path d="M${x + 18 * unit} ${y + 35 * unit}h${64 * unit}l-${5 * unit} ${50 * unit}H${x + 23 * unit}zM${x + 36 * unit} ${y + 38 * unit}v-${9 * unit}c0-${18 * unit} ${28 * unit}-${18 * unit} ${28 * unit} 0v${9 * unit}"/></g>`;
    case "gift": return `<g ${common}><rect x="${x + 15 * unit}" y="${y + 39 * unit}" width="${70 * unit}" height="${47 * unit}"/><path d="M${x + 10 * unit} ${y + 29 * unit}h${80 * unit}v${17 * unit}H${x + 10 * unit}zM${x + 50 * unit} ${y + 29 * unit}v${57 * unit}M${x + 49 * unit} ${y + 28 * unit}c-${18 * unit}-${1 * unit}-${27 * unit}-${8 * unit}-${24 * unit}-${17 * unit} ${4 * unit}-${11 * unit} ${22 * unit} 1 ${24 * unit} ${17 * unit}M${x + 51 * unit} ${y + 28 * unit}c${18 * unit}-${1 * unit} ${27 * unit}-${8 * unit} ${24 * unit}-${17 * unit}-${4 * unit}-${11 * unit}-${22 * unit} 1-${24 * unit} ${17 * unit}"/></g>`;
    case "location": return `<g ${common}><path d="M${x + 50 * unit} ${y + 88 * unit}s${30 * unit}-${28 * unit} ${30 * unit}-${50 * unit}a${30 * unit} ${30 * unit} 0 1 0-${60 * unit} 0c0 ${22 * unit} ${30 * unit} ${50 * unit} ${30 * unit} ${50 * unit}z"/><circle cx="${x + 50 * unit}" cy="${y + 38 * unit}" r="${10 * unit}"/></g>`;
    default: return `<g ${common}><circle cx="${x + 50 * unit}" cy="${y + 50 * unit}" r="${35 * unit}"/><path d="M${x + 50 * unit} ${y + 45 * unit}v${25 * unit}M${x + 50 * unit} ${y + 31 * unit}h.1"/></g>`;
  }
}

export async function renderRichMenuPng(layout: Layout, slots: Slot[], templateKey: BuiltInRichMenuTemplateKey): Promise<Buffer> {
  const spec = LAYOUTS[layout];
  const theme = RICH_MENU_TEMPLATES[templateKey];
  const bounds = slotBounds(layout);
  const fontFile = path.join(process.cwd(), "assets", "fonts", "NotoSansCJKtc-Bold.otf");
  const artworkFile = path.join(process.cwd(), "public", theme.artwork.replace(/^\//, ""));
  const background = await sharp(artworkFile).resize(spec.width, spec.height, { fit: "cover", position: "centre" }).png().toBuffer();
  const compact = spec.height === 843;
  const iconSize = compact ? 128 : 116;
  const decoration = bounds.map((box, index) => {
    const slot = slots[index] ?? { label: "品牌資訊", action: "brand" as const };
    const iconX = box.x + box.width / 2 - iconSize / 2;
    const iconY = box.y + (compact ? 172 : 238);
    return `<g>
      <line x1="${box.x + box.width / 2 - 42}" y1="${box.y + box.height - 228}" x2="${box.x + box.width / 2 + 42}" y2="${box.y + box.height - 228}" stroke="${theme.accent}" stroke-width="6" stroke-linecap="round"/>
      ${icon(slot.icon ?? richMenuIconForAction(slot.action), iconX, iconY, iconSize, theme.ink)}
    </g>`;
  }).join("");
  const rowHeight = spec.height / spec.rows;
  const rowWashes = Array.from({ length: spec.rows }, (_, row) => `<rect x="0" y="${row * rowHeight}" width="${spec.width}" height="${rowHeight}" fill="url(#row-wash)"/>`).join("");
  const verticalRules = Array.from({ length: spec.cols - 1 }, (_, column) => {
    const x = ((column + 1) * spec.width) / spec.cols;
    return `<line x1="${x}" y1="0" x2="${x}" y2="${spec.height}" stroke="${theme.ink}" stroke-opacity="0.24" stroke-width="2"/>`;
  }).join("");
  const horizontalRules = Array.from({ length: spec.rows - 1 }, (_, row) => {
    const y = ((row + 1) * spec.height) / spec.rows;
    return `<line x1="0" y1="${y}" x2="${spec.width}" y2="${y}" stroke="${theme.ink}" stroke-opacity="0.24" stroke-width="2"/>`;
  }).join("");
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}">
    <defs>
      <linearGradient id="row-wash" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${theme.panel}" stop-opacity="0.08"/>
        <stop offset="0.48" stop-color="${theme.panel}" stop-opacity="0.34"/>
        <stop offset="1" stop-color="${theme.panel}" stop-opacity="0.9"/>
      </linearGradient>
    </defs>
    ${rowWashes}${verticalRules}${horizontalRules}${decoration}
  </svg>`);
  const labels = await Promise.all(bounds.map(async (box, index) => {
    const slot = slots[index] ?? { label: "品牌資訊", action: "brand" as const };
    const fontSize = compact ? 60 : 58;
    const input = await sharp({ text: { text: `<span foreground="${theme.ink}">${escapeXml(slot.label)}</span>`, font: `Noto Sans CJK TC Bold ${fontSize}`, fontfile: fontFile, width: box.width - 120, height: Math.ceil(fontSize * 1.65), align: "center", rgba: true } }).png().toBuffer();
    return { input, left: box.x + 60, top: Math.round(box.y + box.height - 188) };
  }));
  return sharp(background).composite([{ input: overlay, left: 0, top: 0 }, ...labels]).png({ compressionLevel: 9, palette: true, quality: 82, colours: 128 }).toBuffer();
}
