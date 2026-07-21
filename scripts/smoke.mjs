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
  // detached: true makes this the leader of its own process group, so
  // killing -server.pid below takes down vite's actual child process too —
  // `npx vite preview` is two processes, and killing just the npx wrapper
  // orphans a listening vite server that can hang the CI step waiting on it.
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    stdio: "pipe",
    detached: true,
  });
  let serverOutput = "";
  server.stdout.on("data", (d) => (serverOutput += d));
  server.stderr.on("data", (d) => (serverOutput += d));

  const errors = [];
  let browser;
  try {
    await waitForServer(URL);

    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      // ponytail: CI runners (GitHub Actions ubuntu-latest) disable the
      // unprivileged user namespace Chromium's sandbox needs, so it refuses
      // to start at all without this. Fine here — disposable test browser,
      // not a general-purpose browsing session.
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    // domcontentloaded, not networkidle0: the PWA's service-worker precaching
    // keeps making requests, so the network never goes idle and networkidle0
    // hung the CI job rather than failing it. The waitForSelector below is
    // the actual "did it render" check anyway.
    await page.goto(URL, { waitUntil: "domcontentloaded" });

    // A pageerror during initial render is the failure mode this test exists
    // for (fileURLToPath crashing the app before it ever paints) — surface it
    // directly rather than letting the DOM assertions below report a less
    // useful "found nothing" symptom.
    if (errors.length) throw new Error(`page reported errors:\n${errors.join("\n")}`);

    // Gate screen: real heading text, not just a non-empty document. A blank
    // page never gets an h1, so this also catches the crash directly.
    await page.waitForSelector("h1", { timeout: 10_000 });
    const gateHeading = await page.$eval("h1", (el) => el.textContent).catch(() => null);
    if (gateHeading !== "Tides that work with no signal.") {
      throw new Error(`expected the gate heading, got: ${JSON.stringify(gateHeading)}`);
    }

    // Decline location -> the sidebar's amber unavailable card (spec §5e:
    // never an empty screen). With no starred/recent/nearby data yet (Task
    // 4a wires persistence; this is a known transitional gap until then and
    // Search, its own task, is the escape hatch to every other station),
    // CURRENT LOCATION's unavailable state is the only sidebar content, so
    // that real text rendering is what proves the page did not blank out.
    const declineButton = await page.$$eval("button", (buttons) =>
      buttons.findIndex((b) => b.textContent?.includes("Choose a station instead")),
    );
    if (declineButton === -1) throw new Error('no "Choose a station instead" button found');
    const buttons = await page.$$("button");
    await buttons[declineButton].click();
    await page.waitForSelector(".location-card.unavailable .location-title", { timeout: 5_000 });

    const locationTitle = await page.$eval(
      ".location-card.unavailable .location-title",
      (el) => el.textContent,
    );
    if (locationTitle?.trim() !== "Location unavailable") {
      throw new Error(`expected the unavailable-location card, got: ${JSON.stringify(locationTitle)}`);
    }

    const tideHeight = await page.$eval(".reading .value", (el) => el.textContent);
    if (!/\d/.test(tideHeight ?? "")) throw new Error(`expected a tide height, got: ${JSON.stringify(tideHeight)}`);

    // This is the regression Task 5 exists to close: with location declined,
    // the sidebar's Current location/Starred/Recent/Nearby groups have no
    // data (Task 4a's persistence is still pending), so Search is the only
    // path to any of the other 40 stations. Confirm it actually is one —
    // open it and select a station that is not the fallback already showing.
    const searchEntryIndex = await page.$$eval("button", (buttons) =>
      buttons.findIndex((b) => b.textContent?.includes("Search stations")),
    );
    if (searchEntryIndex === -1) throw new Error('no "Search stations" button found in the sidebar');
    const sidebarButtons = await page.$$("button");
    await sidebarButtons[searchEntryIndex].click();

    await page.waitForSelector("h1", { timeout: 5_000 });
    const searchHeading = await page.$eval("h1", (el) => el.textContent);
    if (searchHeading !== "Search") {
      throw new Error(`expected the Search screen heading, got: ${JSON.stringify(searchHeading)}`);
    }

    await page.waitForSelector(".station-card", { timeout: 5_000 });
    const popularCount = (await page.$$(".station-card")).length;
    if (popularCount === 0) throw new Error("Search showed no POPULAR stations on an empty query");

    await page.type(".search-input", "everett");
    await page.waitForFunction(
      () => document.querySelector(".station-card-name")?.textContent === "Everett",
      { timeout: 5_000 },
    );
    const stationCard = await page.$(".station-card");
    await stationCard.click();

    // Selecting a result returns to the main screen showing that station.
    await page.waitForFunction(
      () => document.querySelector(".place h1")?.textContent === "Everett",
      { timeout: 5_000 },
    );

    // Task 6: a deep link renders its station directly, no navigation
    // through it required. A fresh tab, not the page above — this is the
    // feature (opening a shared URL cold), not a continuation of the
    // in-app session. Without the URL a fresh load falls back to the
    // gate's default station (Friday Harbor, not Everett), so this also
    // proves the route — not leftover state — picked the station.
    const deepLinkErrors = [];
    const deepLinkPage = await browser.newPage();
    deepLinkPage.on("pageerror", (err) => deepLinkErrors.push(`pageerror: ${err.message}`));
    deepLinkPage.on("console", (msg) => {
      if (msg.type() === "error") deepLinkErrors.push(`console.error: ${msg.text()}`);
    });
    await deepLinkPage.goto(`${URL}tide/everett/2026-07-20T14:35-07:00`, {
      waitUntil: "domcontentloaded",
    });
    if (deepLinkErrors.length) {
      throw new Error(`deep link page reported errors:\n${deepLinkErrors.join("\n")}`);
    }
    await deepLinkPage.waitForSelector(".place h1", { timeout: 10_000 });
    const deepLinkStation = await deepLinkPage.$eval(".place h1", (el) => el.textContent);
    if (deepLinkStation !== "Everett") {
      throw new Error(
        `deep link /tide/everett/2026-07-20T14:35-07:00 expected Everett, got: ${JSON.stringify(deepLinkStation)}`,
      );
    }
    const deepLinkHeight = await deepLinkPage.$eval(".reading .value", (el) => el.textContent);
    if (!/\d/.test(deepLinkHeight ?? "")) {
      throw new Error(`deep link expected a tide height, got: ${JSON.stringify(deepLinkHeight)}`);
    }
    await deepLinkPage.close();

    if (errors.length) {
      throw new Error(`page reported errors:\n${errors.join("\n")}`);
    }

    console.log(
      `smoke OK — location card "${locationTitle.trim()}", tide height "${tideHeight}", ` +
        `search reached "Everett" from ${popularCount} POPULAR stations, ` +
        `deep link rendered "${deepLinkStation}" at "${deepLinkHeight}"`,
    );
  } finally {
    if (browser) await browser.close();
    // Negative pid targets the whole detached process group (npx + vite),
    // not just the npx wrapper.
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill();
    }
  }
}

// Belt and suspenders on top of the per-step timeouts above: nothing here
// should ever run this long, and a hang in CI is worse than a failure.
const watchdog = setTimeout(() => {
  console.error("SMOKE FAILED: timed out after 60s");
  process.exit(1);
}, 60_000);
watchdog.unref();

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("SMOKE FAILED:", err.message);
    process.exit(1);
  });
