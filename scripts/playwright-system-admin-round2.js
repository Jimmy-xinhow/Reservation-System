async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const targets = [
    { path: "/admin/platform", shot: "output/playwright/review-final/24-system-admin-desktop.png" },
    { path: "/admin/platform/reports", shot: "output/playwright/review-final/25-trial-observation.png" },
    { path: "/admin/platform/admins", shot: "output/playwright/review-final/26-system-permission-presets.png" },
  ];
  const results = [];
  for (const target of targets) {
    await page.goto(`https://reservation-system-staging-staging.up.railway.app${target.path}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: target.shot, fullPage: true });
    results.push({
      requested: target.path,
      landed: page.url().replace("https://reservation-system-staging-staging.up.railway.app", "").split("?")[0],
      roleVisible: (await page.locator("body").innerText()).includes("系統管理者"),
      overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      applicationErrors: await page.getByText("Application error", { exact: false }).count(),
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("https://reservation-system-staging-staging.up.railway.app/admin/platform/reports");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "output/playwright/review-final/27-mobile-system-reports.png", fullPage: true });
  results.push({
    requested: "/admin/platform/reports@390",
    landed: page.url().replace("https://reservation-system-staging-staging.up.railway.app", "").split("?")[0],
    overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    applicationErrors: await page.getByText("Application error", { exact: false }).count(),
  });
  return { results, errors };
}
