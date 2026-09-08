import "server-only";

import sharp from "sharp";
import path from "node:path";
import { LAYOUTS, RICH_MENU_TEMPLATES, slotBounds, type BuiltInRichMenuTemplateKey, type Layout, type Slot } from "@/lib/richmenu";

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function icon(action: Slot["action"], x: number, y: number, size: number, stroke: string): string {
  const sw = Math.max(9, Math.round(size * 0.052));
  const common = `fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  const unit = size / 100;
  switch (action) {
    case "booking": return `<g ${common}><rect x="${x + 14 * unit}" y="${y + 20 * unit}" width="${72 * unit}" height="${66 * unit}" rx="${10 * unit}"/><path d="M${x + 14 * unit} ${y + 40 * unit}h${72 * unit}M${x + 32 * unit} ${y + 12 * unit}v${17 * unit}M${x + 68 * unit} ${y + 12 * unit}v${17 * unit}M${x + 34 * unit} ${y + 62 * unit}l${10 * unit} ${10 * unit} ${23 * unit}-${25 * unit}"/></g>`;
    case "appointments": case "query": return `<g ${common}><circle cx="${x + 50 * unit}" cy="${y + 50 * unit}" r="${35 * unit}"/><path d="M${x + 50 * unit} ${y + 29 * unit}v${23 * unit}l${17 * unit} ${10 * unit}"/></g>`;
    case "events": return `<g ${common}><path d="M${x + 15 * unit} ${y + 34 * unit}h${70 * unit}v${49 * unit}H${x + 15 * unit}zM${x + 15 * unit} ${y + 47 * unit}h${70 * unit}M${x + 31 * unit} ${y + 19 * unit}v${20 * unit}M${x + 69 * unit} ${y + 19 * unit}v${20 * unit}"/><path d="M${x + 33 * unit} ${y + 62 * unit}h${13 * unit}M${x + 56 * unit} ${y + 62 * unit}h${13 * unit}"/></g>`;
    case "tickets": return `<g ${common}><rect x="${x + 14 * unit}" y="${y + 27 * unit}" width="${72 * unit}" height="${58 * unit}" rx="${9 * unit}"/><path d="M${x + 57 * unit} ${y + 27 * unit}v${10 * unit}m0 ${10 * unit}v${12 * unit}m0 ${10 * unit}v${16 * unit}M${x + 28 * unit} ${y + 50 * unit}h${17 * unit}M${x + 28 * unit} ${y + 64 * unit}h${13 * unit}"/></g>`;
    case "membership": return `<g ${common}><path d="M${x + 50 * unit} ${y + 86 * unit}C${x + 18 * unit} ${y + 68 * unit},${x + 12 * unit} ${y + 48 * unit},${x + 20 * unit} ${y + 32 * unit}C${x + 29 * unit} ${y + 15 * unit},${x + 47 * unit} ${y + 22 * unit},${x + 50 * unit} ${y + 35 * unit}C${x + 53 * unit} ${y + 22 * unit},${x + 71 * unit} ${y + 15 * unit},${x + 80 * unit} ${y + 32 * unit}C${x + 88 * unit} ${y + 48 * unit},${x + 82 * unit} ${y + 68 * unit},${x + 50 * unit} ${y + 86 * unit}z"/></g>`;
    case "support": return `<g ${common}><path d="M${x + 16 * unit} ${y + 20 * unit}h${68 * unit}v${50 * unit}H${x + 48 * unit}L${x + 29 * unit} ${y + 86 * unit}l${4 * unit}-${16 * unit}H${x + 16 * unit}z"/><path d="M${x + 34 * unit} ${y + 45 * unit}h${32 * unit}M${x + 34 * unit} ${y + 58 * unit}h${21 * unit}"/></g>`;
    case "brand": case "info": return `<g ${common}><circle cx="${x + 50 * unit}" cy="${y + 34 * unit}" r="${18 * unit}"/><path d="M${x + 18 * unit} ${y + 86 * unit}c${5 * unit}-${28 * unit} ${18 * unit}-${38 * unit} ${32 * unit}-${38 * unit}s${27 * unit} ${10 * unit} ${32 * unit} ${38 * unit}"/></g>`;
    default: return `<g ${common}><circle cx="${x + 50 * unit}" cy="${y + 50 * unit}" r="${35 * unit}"/><path d="M${x + 50 * unit} ${y + 45 * unit}v${25 * unit}M${x + 50 * unit} ${y + 31 * unit}h.1"/></g>`;
  }
}

export async function renderRichMenuPng(layout: Layout, slots: Slot[], templateKey: BuiltInRichMenuTemplateKey): Promise<Buffer> {
  const spec = LAYOUTS[layout];
  const theme = RICH_MENU_TEMPLATES[templateKey];
  const bounds = slotBounds(layout);
  const fontFile = path.join(process.cwd(), "assets", "fonts", "NotoSansTC-RichMenu.ttf");
  const artworkFile = path.join(process.cwd(), "public", theme.artwork.replace(/^\//, ""));
  const background = await sharp(artworkFile).resize(spec.width, spec.height, { fit: "cover", position: "centre" }).png().toBuffer();
  const compact = spec.height === 843;
  const iconSize = compact ? 155 : 145;
  const decoration = bounds.map((box, index) => {
    const slot = slots[index] ?? { label: "品牌資訊", action: "brand" as const };
    const iconX = box.x + box.width / 2 - iconSize / 2;
    const iconY = box.y + (compact ? 130 : 120);
    return `<g>
      <rect x="${box.x + 22}" y="${box.y + 22}" width="${box.width - 44}" height="${box.height - 44}" rx="20" fill="${theme.panel}" fill-opacity="0.82" stroke="${theme.accent}" stroke-opacity="0.52" stroke-width="3"/>
      <line x1="${box.x + 80}" y1="${box.y + box.height - 112}" x2="${box.x + box.width - 80}" y2="${box.y + box.height - 112}" stroke="${theme.accent}" stroke-width="5" stroke-opacity="0.9"/>
      ${icon(slot.action, iconX, iconY, iconSize, theme.ink)}
    </g>`;
  }).join("");
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}">${decoration}</svg>`);
  const labels = await Promise.all(bounds.map(async (box, index) => {
    const slot = slots[index] ?? { label: "品牌資訊", action: "brand" as const };
    const fontSize = compact ? 61 : 56;
    const input = await sharp({ text: { text: `<span foreground="${theme.ink}"><b>${escapeXml(slot.label)}</b></span>`, font: `Noto Sans TC ${fontSize}`, fontfile: fontFile, width: box.width - 120, height: Math.ceil(fontSize * 1.65), align: "center", rgba: true } }).png().toBuffer();
    return { input, left: box.x + 60, top: Math.round(box.y + box.height - (compact ? 220 : 245)) };
  }));
  return sharp(background).composite([{ input: overlay, left: 0, top: 0 }, ...labels]).png({ compressionLevel: 9, palette: true, quality: 82, colours: 128 }).toBuffer();
}
