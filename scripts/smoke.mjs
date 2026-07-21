#!/usr/bin/env node
// Render smoke test: serves dist/, loads it in headless Chrome, and fails on
// any pageerror or a page that never renders real content. Unit tests import
// modules directly under Node, where node:fs exists — this is the check that
// actually loads the built bundle in a browser, which is what shipped blank.
//
// Chrome: $CHROME_PATH in CI (browser-actions/setup-chrome), the local macOS
// install otherwise. Same script both places.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const PORT = 4319;
const URL = `http://localhost:${PORT}/`;
const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PATH = process.env.CHROME_PATH || MAC_CHROME;

if (!existsSync(CHROME_PATH)) {
  console.error(`No Chrome at ${CHROME_PATH}. Set $CHROME_PATH or install Chrome locally.`);
  process.exit(1);
}

function waitForServer(url, timeoutMs = 15_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (async function poll() {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() - start > timeoutMs) return reject(new Error(`server never came up at ${url}`));
      setTimeout(poll, 200);
    })();
  });
}

async function main() {
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    stdio: "pipe",
  });
  let serverOutput = "";
  server.stdout.on("data", (d) => (serverOutput += d));
  server.stderr.on("data", (d) => (serverOutput += d));

  const errors = [];
  let browser;
  try {
    await waitForServer(URL);

    browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });
    const page = await browser.newPage();
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto(URL, { waitUntil: "networkidle0" });

    // A pageerror during initial render is the failure mode this test exists
    // for (fileURLToPath crashing the app before it ever paints) — surface it
    // directly rather than letting the DOM assertions below report a less
    // useful "found nothing" symptom.
    if (errors.length) throw new Error(`page reported errors:\n${errors.join("\n")}`);

    // Gate screen: real heading text, not just a non-empty document.
    const gateHeading = await page.$eval("h1", (el) => el.textContent).catch(() => null);
    if (gateHeading !== "Tides that work with no signal.") {
      throw new Error(`expected the gate heading, got: ${JSON.stringify(gateHeading)}`);
    }

    // Decline location -> station list path (spec §5e: never an empty screen).
    const declineButton = await page.$$eval("button", (buttons) =>
      buttons.findIndex((b) => b.textContent?.includes("Choose a station instead")),
    );
    if (declineButton === -1) throw new Error('no "Choose a station instead" button found');
    const buttons = await page.$$("button");
    await buttons[declineButton].click();
    await page.waitForSelector(".station-rows .station-name", { timeout: 5_000 });

    const stationName = await page.$eval(".station-rows .station-name .primary", (el) => el.textContent);
    if (!stationName || !stationName.trim()) throw new Error("station list rendered with no station name");

    const tideHeight = await page.$eval(".reading .value", (el) => el.textContent);
    if (!/\d/.test(tideHeight ?? "")) throw new Error(`expected a tide height, got: ${JSON.stringify(tideHeight)}`);

    // ponytail: deep-link coverage deferred until Task 6 lands a route to link to.

    if (errors.length) {
      throw new Error(`page reported errors:\n${errors.join("\n")}`);
    }

    console.log(`smoke OK — station "${stationName.trim()}", tide height "${tideHeight}"`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err.message);
  process.exit(1);
});
