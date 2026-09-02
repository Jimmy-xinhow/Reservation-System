async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const targets = [
    { path: "/admin/dashboard", shot: "output/playwright/review-final/28-brand-admin-desktop.png" },
    { path: "/admin/import", shot: "output/playwright/review-final/29-csv-import.png" },
    { path: "/admin/channels", shot: "output/playwright/review-final/30-channel-test-center.png" },
    { path: "/admin/handoff", shot: "output/playwright/review-final/31-handoff-tasks.png" },
    { path: "/admin/services", shot: "output/playwright/review-final/32-service-form-addons.png" },
    { path: "/admin/messages", shot: "output/playwright/review-final/33-message-presets.png" },
    { path: "/admin/users", shot: "output/playwright/review-final/34-brand-permission-presets.png" },
  ];
  const results = [];
  for (const target of targets) {
    await page.goto(`https://reservation-system-staging-staging.up.railway.app${target.path}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: target.shot, fullPage: true });
    results.push({
      requested: target.path,
      landed: page.url().replace("https://reservation-system-staging-staging.up.railway.app", "").split("?")[0],
      roleVisible: (await page.locator("body").innerText()).includes("品牌管理者"),
      overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      applicationErrors: await page.getByText("Application error", { exact: false }).count(),
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const target of [
    { path: "/admin/import", shot: "output/playwright/review-final/35-mobile-csv-import.png" },
    { path: "/admin/channels", shot: "output/playwright/review-final/36-mobile-channel-tests.png" },
  ]) {
    await page.goto(`https://reservation-system-staging-staging.up.railway.app${target.path}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: target.shot, fullPage: true });
    results.push({ requested: `${target.path}@390`, landed: page.url().replace("https://reservation-system-staging-staging.up.railway.app", "").split("?")[0], overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), applicationErrors: await page.getByText("Application error", { exact: false }).count() });
  }
  return { results, errors };
}
