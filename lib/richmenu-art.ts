import "server-only";

import sharp from "sharp";
import path from "node:path";
import { LAYOUTS, slotBounds, type Layout, type Slot } from "@/lib/richmenu";

const COLORS = {
  ink: "#173F48",
  line: "#06C755",
  cream: "#F7F3EA",
  white: "#FFFFFF",
  gold: "#E2B644",
  mist: "#DDEBE9",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}

function icon(action: Slot["action"], x: number, y: number, size: number): string {
  const stroke = COLORS.ink;
  const sw = Math.max(10, Math.round(size * 0.055));
  const common = `fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  const unit = size / 100;
  switch (action) {
    case "booking":
      return `<g ${common}><rect x="${x + 14 * unit}" y="${y + 20 * unit}" width="${72 * unit}" height="${66 * unit}" rx="${10 * unit}"/><path d="M${x + 14 * unit} ${y + 40 * unit}h${72 * unit}M${x + 32 * unit} ${y + 12 * unit}v${17 * unit}M${x + 68 * unit} ${y + 12 * unit}v${17 * unit}M${x + 34 * unit} ${y + 62 * unit}l${10 * unit} ${10 * unit} ${23 * unit}-${25 * unit}"/></g>`;
    case "appointments":
    case "query":
      return `<g ${common}><circle cx="${x + 50 * unit}" cy="${y + 50 * unit}" r="${35 * unit}"/><path d="M${x + 50 * unit} ${y + 29 * unit}v${23 * unit}l${17 * unit} ${10 * unit}M${x + 28 * unit} ${y + 82 * unit}l-${13 * unit} ${8 * unit}"/></g>`;
    case "events":
      return `<g ${common}><path d="M${x + 15 * unit} ${y + 34 * unit}h${70 * unit}v${49 * unit}H${15 * unit}zM${x + 15 * unit} ${y + 47 * unit}h${70 * unit}M${x + 31 * unit} ${y + 19 * unit}v${20 * unit}M${x + 69 * unit} ${y + 19 * unit}v${20 * unit}"/><path d="M${x + 33 * unit} ${y + 62 * unit}h${13 * unit}M${x + 56 * unit} ${y + 62 * unit}h${13 * unit}"/></g>`;
    case "tickets":
      return `<g ${common}><path d="M${x + 14 * unit} ${y + 31 * unit}h${72 * unit}v${18 * unit}a${12 * unit} ${12 * unit} 0 0 0 0 ${24 * unit}v${16 * unit}H${14 * unit}V${73 * unit}a${12 * unit} ${12 * unit} 0 0 0 0-${0} -${24 * unit}zM${x + 54 * unit} ${y + 31 * unit}v${9 * unit}m0 ${10 * unit}v${12 * unit}m0 ${10 * unit}v${17 * unit}"/></g>`;
    case "membership":
      return `<g ${common}><path d="M${x + 50 * unit} ${y + 87 * unit}s-${34 * unit}-${20 * unit}-${34 * unit}-${45 * unit}a${19 * unit} ${19 * unit} 0 0 1 ${34 * unit}-${12 * unit}A${19 * unit} ${19 * unit} 0 0 1 ${84 * unit} ${y + 42 * unit}c0 ${25 * unit}-${34 * unit} ${45 * unit}-${34 * unit} ${45 * unit}z"/></g>`;
    case "support":
      return `<g ${common}><path d="M${x + 16 * unit} ${y + 20 * unit}h${68 * unit}v${50 * unit}H${48 * unit}L${29 * unit} ${y + 86 * unit}l${4 * unit}-${16 * unit}H${16 * unit}z"/><path d="M${x + 34 * unit} ${y + 45 * unit}h${32 * unit}M${x + 34 * unit} ${y + 58 * unit}h${21 * unit}"/></g>`;
    default:
      return `<g ${common}><circle cx="${x + 50 * unit}" cy="${y + 50 * unit}" r="${35 * unit}"/><path d="M${x + 50 * unit} ${y + 45 * unit}v${25 * unit}M${x + 50 * unit} ${y + 31 * unit}h.1"/></g>`;
  }
}

export async function renderRichMenuPng(layout: Layout, slots: Slot[]): Promise<Buffer> {
  const spec = LAYOUTS[layout];
  const bounds = slotBounds(layout);
  const fontFile = path.join(process.cwd(), "assets", "fonts", "NotoSansTC-RichMenu.ttf");
  const cells = bounds.map((box, index) => {
    const slot = slots[index] ?? { label: "品牌資訊", action: "brand" as const };
    const compact = spec.rows === 1 && spec.height === 843;
    const iconSize = compact ? 185 : 185;
    const iconX = box.x + box.width / 2 - iconSize / 2;
    const iconY = box.y + (compact ? 145 : 105);
    const labelY = iconY + iconSize + (compact ? 78 : 84);
    const stripe = index === 0 ? COLORS.line : index === 4 ? COLORS.gold : COLORS.mist;
    const alternate = index % 2 === 0 ? COLORS.white : COLORS.cream;
    return `<g>
      <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${alternate}"/>
      <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${compact ? 22 : 18}" fill="${stripe}"/>
      ${icon(slot.action, iconX, iconY, iconSize)}
      <text x="${box.x + box.width / 2}" y="${labelY + 52}" text-anchor="middle" fill="#58717A" font-family="Arial, sans-serif" font-size="${compact ? 24 : 22}" font-weight="700" letter-spacing="3">XINHOW SERVICE</text>
      <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" stroke="#C9D8D7" stroke-width="4"/>
    </g>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}">
    <rect width="100%" height="100%" fill="${COLORS.cream}"/>
    ${cells}
  </svg>`;
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  const overlays = await Promise.all(bounds.map(async (box, index) => {
    const slot = slots[index] ?? { label: "品牌資訊", action: "brand" as const };
    const compact = spec.rows === 1 && spec.height === 843;
    const fontSize = compact ? 66 : 61;
    const iconY = box.y + (compact ? 145 : 105);
    const labelY = iconY + 185 + (compact ? 78 : 84);
    const input = await sharp({
      text: {
        text: escapeXml(slot.label),
        font: `Noto Sans TC ${fontSize}`,
        fontfile: fontFile,
        width: box.width - 80,
        height: Math.ceil(fontSize * 1.7),
        align: "center",
        rgba: true,
      },
    }).png().toBuffer();
    return { input, left: box.x + 40, top: Math.round(labelY - fontSize * 1.15) };
  }));
  return sharp(base).composite(overlays).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
}
