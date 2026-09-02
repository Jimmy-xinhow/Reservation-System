async (page) => {
  await page.waitForLoadState("networkidle");
  return {
    url: page.url(),
    text: (await page.locator("body").innerText()).slice(0, 4_000),
    links: await page.locator("a").evaluateAll((links) => links.map((link) => ({
      text: (link.textContent ?? "").trim(),
      href: link.getAttribute("href"),
    })).filter((link) => link.text || link.href)),
    buttons: await page.locator("button").evaluateAll((buttons) => buttons.map((button) => ({
      text: (button.textContent ?? "").trim(),
      disabled: button.disabled,
    }))),
    applicationErrors: await page.getByText("Application error", { exact: false }).count(),
    horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
}
