async (page) => {
  const origin = "https://reservation-system-staging-staging.up.railway.app";
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const results = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${origin}/admin/platform/admins`);
    await page.waitForLoadState("networkidle");
    const body = await page.locator("body").innerText();
    await page.screenshot({ path: `output/playwright/review-final/${viewport.width === 390 ? "38-mobile-system-employee.png" : "37-system-employee.png"}`, fullPage: true });
    results.push({ viewport: `${viewport.width}x${viewport.height}`, requested: "/admin/platform/admins", landed: page.url().replace(origin, "").split("?")[0], permissionNotice: body.includes("權限"), overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), applicationErrors: await page.getByText("Application error", { exact: false }).count() });
  }
  return { results, errors };
}
