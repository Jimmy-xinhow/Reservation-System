const { chromium } = require(
  "C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
);

async function main() {
  const sourceUrl = process.argv[2];
  const outputPath = process.argv[3];
  if (!sourceUrl || !outputPath) {
    throw new Error("Usage: node scripts/render_manual_html.cjs <url> <output.pdf>");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: "networkidle", timeout: 60_000 });
    const imageState = await page.evaluate(async () => {
      const images = Array.from(document.images);
      await Promise.all(
        images.map(async (image) => {
          if (!image.complete) {
            await new Promise((resolve, reject) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", reject, { once: true });
            });
          }
          await image.decode();
        })
      );
      return {
        count: images.length,
        decoded: images.filter((image) => image.naturalWidth > 0).length,
      };
    });
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    process.stdout.write(`${JSON.stringify(imageState)}\n${outputPath}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
