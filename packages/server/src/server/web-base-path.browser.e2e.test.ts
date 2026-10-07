import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { startPrefixProxy, type PrefixProxy } from "./test-utils/prefix-proxy.js";

// The bundled daemon web UI, built by `npm run build:daemon-web-ui`.
const distDir =
  process.env.PASEO_TEST_WEB_UI_DIST ??
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../dist/server/web-ui");

let daemon: TestPaseoDaemon;
let proxy: PrefixProxy;
let browser: Browser;

beforeAll(async () => {
  if (!existsSync(path.join(distDir, "index.html"))) {
    throw new Error(`No built web UI at ${distDir}; run npm run build:daemon-web-ui first`);
  }
  daemon = await createTestPaseoDaemon({
    webUi: { enabled: true, distDir },
    sessionRuntime: { timelineDrainMs: 2_000, singleAgent: false, webBasePath: "/s/x/" },
  });
  proxy = await startPrefixProxy({ prefix: "/s/x/", targetPort: daemon.port });
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await proxy?.close();
  await daemon?.close();
});

test("the web UI loads under /s/x/ behind a prefix-preserving proxy and connects its websocket there", async () => {
  const origin = `http://127.0.0.1:${proxy.port}`;
  const page = await browser.newPage();
  const requested: string[] = [];
  const failed: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  page.on("response", (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      failed.push(`${response.status()} ${response.url()}`);
    }
  });
  const socket = page.waitForEvent("websocket", {
    predicate: (ws) => ws.url() === `ws://127.0.0.1:${proxy.port}/s/x/ws`,
    timeout: 60_000,
  });

  await page.goto(`${origin}/s/x/`);
  await socket;

  // The app reached its connected shell, and its router stays under the prefix.
  await page.getByTestId("sidebar-settings").waitFor({ timeout: 60_000 });
  expect(new URL(page.url()).pathname.startsWith("/s/x/")).toBe(true);
  const ownRequests = requested.filter((url) => url.startsWith(origin));
  expect(ownRequests.length).toBeGreaterThan(0);
  expect(ownRequests.filter((url) => !url.startsWith(`${origin}/s/x/`))).toEqual([]);
  expect(failed).toEqual([]);

  // A reload of the deep link the router chose comes back to the app.
  await page.reload();
  await page.getByTestId("sidebar-settings").waitFor({ timeout: 60_000 });
  expect(new URL(page.url()).pathname.startsWith("/s/x/")).toBe(true);
  await page.close();
}, 180_000);
