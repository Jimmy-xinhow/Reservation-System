async (page) => {
  const origin = "https://reservation-system-staging-staging.up.railway.app";
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const results = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${origin}/admin/users`);
    await page.waitForLoadState("networkidle");
    const body = await page.locator("body").innerText();
    await page.screenshot({ path: `output/playwright/review-final/${viewport.width === 390 ? "40-mobile-brand-employee.png" : "39-brand-employee.png"}`, fullPage: true });
    results.push({ viewport: `${viewport.width}x${viewport.height}`, requested: "/admin/users", landed: page.url().replace(origin, "").split("?")[0], permissionNotice: body.includes("權限"), overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), applicationErrors: await page.getByText("Application error", { exact: false }).count() });
  }
  return { results, errors };
}
