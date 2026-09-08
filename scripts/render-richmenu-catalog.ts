import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { renderRichMenuPng } from "../lib/richmenu-art";
import { RICH_MENU_TEMPLATE_KEYS, richMenuTemplate } from "../lib/richmenu";

async function main() {
  const availability = { booking: true, events: true, tickets: true, memberships: true, line: true, legacyProgress: false };
  const outputDir = path.join(process.cwd(), "output", "playwright", "richmenu-catalog");
  await fs.mkdir(outputDir, { recursive: true });
  const thumbs: Array<{ input: Buffer; left: number; top: number }> = [];
  for (const [index, key] of RICH_MENU_TEMPLATE_KEYS.entries()) {
    const template = richMenuTemplate(key, availability);
    const png = await renderRichMenuPng(template.layout, template.slots, key);
    await fs.writeFile(path.join(outputDir, `${key}.png`), png);
    const thumb = await sharp(png).resize(600, 405, { fit: "cover" }).png().toBuffer();
    thumbs.push({ input: thumb, left: (index % 3) * 620, top: Math.floor(index / 3) * 425 });
  }
  await sharp({ create: { width: 1840, height: 1680, channels: 4, background: "#e9eceb" } }).composite(thumbs).png().toFile(path.join(outputDir, "catalog-contact-sheet.png"));
  console.log(`Rendered ${RICH_MENU_TEMPLATE_KEYS.length} templates to ${outputDir}`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
