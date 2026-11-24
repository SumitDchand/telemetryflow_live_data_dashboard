import { chromium } from "@playwright/test";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto("http://127.0.0.1:5173");
await p.waitForTimeout(1500);
console.log(
  await p.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll("body *")]
      .map((e) => ({
        tag: e.tagName,
        cls: e.className?.baseVal ?? e.className,
        rect: e.getBoundingClientRect().toJSON(),
        scroll: e.scrollWidth,
      }))
      .filter((e) => e.rect.x >= 0 && e.rect.right > innerWidth + 1)
      .slice(0, 25),
  })),
);
await b.close();
