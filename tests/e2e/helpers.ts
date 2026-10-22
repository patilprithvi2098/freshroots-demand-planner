import type { Page, Route } from "@playwright/test";

/**
 * Safety for a test suite that runs against a real database:
 * - every native confirm()/alert() is dismissed, so "Remove" and "Delete goal" can never go through;
 * - mutating calls to an API are answered by a stub, so a "successful" submit never writes a row.
 * Requests that are expected to be rejected (invalid input) are allowed through to the real API,
 * which validates before touching the database.
 */
export function guardDialogs(page: Page) {
  page.on("dialog", (d) => d.dismiss());
}

type StubOptions = { delayMs?: number; status?: number; body?: unknown; methods?: string[] };

/** Stubs mutating requests to `urlGlob`, returns a counter of how many were made. */
export async function stubWrites(page: Page, urlGlob: string, opts: StubOptions = {}) {
  const methods = opts.methods ?? ["POST", "PATCH", "PUT", "DELETE"];
  const counter = { count: 0 };
  await page.route(urlGlob, async (route: Route) => {
    if (!methods.includes(route.request().method())) return route.fallback();
    counter.count += 1;
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    await route.fulfill({
      status: opts.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(opts.body ?? { ok: true }),
    });
  });
  return counter;
}

/** Counts mutating requests without answering them, for "nothing should be sent" assertions. */
export function countWrites(page: Page, pathPrefix: string) {
  const counter = { count: 0 };
  page.on("request", (r) => {
    if (r.url().includes(pathPrefix) && r.method() !== "GET") counter.count += 1;
  });
  return counter;
}

/**
 * The key a keyboard user presses to move focus. Safari (WebKit) skips buttons and links on plain Tab
 * by default; Option+Tab visits every focusable element, so that is what a Safari keyboard user presses.
 */
export const tabKey = (page: Page) => (page.context().browser()?.browserType().name() === "webkit" ? "Alt+Tab" : "Tab");

/** Moves focus forward until the predicate matches the focused element, or gives up. */
export async function tabUntil(page: Page, predicate: string, maxTabs = 30) {
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press(tabKey(page));
    const hit = await page.evaluate((p) => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && el.matches(p);
    }, predicate);
    if (hit) return true;
  }
  return false;
}

export async function hasHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

const DAY = 24 * 60 * 60 * 1000;
export const isoDate = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
