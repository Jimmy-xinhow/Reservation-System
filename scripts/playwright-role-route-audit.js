async (page) => {
  const paths = [
    "/admin",
    "/admin/schedules",
    "/admin/services",
    "/admin/resources",
    "/admin/exceptions",
    "/admin/audit",
    "/admin/users",
    "/admin/richmenu",
  ];
  const currentUrl = page.url();
  const origin = currentUrl.slice(0, currentUrl.indexOf("/", currentUrl.indexOf("//") + 2));
  const results = [];

  for (const path of paths) {
    await page.goto(`${origin}${path}`);
    await page.waitForLoadState("networkidle");
    results.push({
      requested: path,
      landed: page.url().slice(origin.length).split("?")[0],
      role: (await page.locator("body").innerText()).includes("品牌員工") ? "品牌員工" : null,
      applicationErrors: await page.getByText("Application error", { exact: false }).count(),
      horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    });
  }

  return results;
}
