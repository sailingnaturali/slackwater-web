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

    // Task 9: the app's whole claim is that it works with no signal. A fresh
    // page (not the ones above, which have already navigated around and
    // could be carrying in-memory state that masks a real offline failure) —
    // load it online first so the service worker installs, precaches, and
    // claims the client, then cut the network at the protocol level and
    // prove the app still renders after a reload.
    const offlineErrors = [];
    const offlinePage = await browser.newPage();
    await offlinePage.goto(URL, { waitUntil: "domcontentloaded" });

    // Wait for the service worker to actually claim this page (skipWaiting +
    // clientsClaim are both on) rather than just registering — a reload
    // before this point would 404 offline and prove nothing.
    await offlinePage.waitForFunction(() => navigator.serviceWorker.controller != null, {
      timeout: 15_000,
    });

    const cdp = await offlinePage.createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });

    // Prove the network is really down before trusting anything below.
    // navigator.onLine lies under this exact emulation (reports true even
    // with the network cut) — this project has been fooled by it before, so
    // only a real fetch failure counts as proof.
    const networkState = await offlinePage.evaluate(() =>
      fetch("https://example.com/" + Math.random())
        .then(() => "UP")
        .catch(() => "down"),
    );
    if (networkState !== "down") {
      throw new Error(`network emulation did not take effect: fetch reported "${networkState}"`);
    }

    // Listeners attach only now: the proof fetch above deliberately targets an
    // unreachable origin, and Chrome logs its own "Failed to load resource"
    // line for that regardless of the JS-level .catch() — a false positive if
    // counted as an app error. Real app breakage during the reload below is
    // what these are for.
    offlinePage.on("pageerror", (err) => offlineErrors.push(`pageerror: ${err.message}`));
    offlinePage.on("console", (msg) => {
      if (msg.type() === "error") offlineErrors.push(`console.error: ${msg.text()}`);
    });

    await offlinePage.reload({ waitUntil: "domcontentloaded" });

    // A blank page still has a valid document, so assert real content, not
    // just that the reload didn't throw.
    await offlinePage.waitForSelector(".place h1", { timeout: 10_000 });
    const offlineStationName = await offlinePage.$eval(".place h1", (el) => el.textContent);
    if (!offlineStationName) throw new Error("offline reload: no station name rendered");

    const offlineHeight = await offlinePage.$eval(".reading .value", (el) => el.textContent);
    if (!/\d/.test(offlineHeight ?? "")) {
      throw new Error(`offline reload expected a tide height, got: ${JSON.stringify(offlineHeight)}`);
    }

    const offlineEventCount = (await offlinePage.$$(".event-rows .event")).length;
    if (offlineEventCount === 0) throw new Error("offline reload: the day's events did not render");

    await offlinePage.waitForSelector(".chart", { timeout: 5_000 });

    const footerText = await offlinePage.$$eval(".muted", (els) => els.map((e) => e.textContent).join(" "));
    if (!/\b41\b/.test(footerText)) {
      throw new Error(`offline reload: station count missing from footer, got: ${JSON.stringify(footerText)}`);
    }

    if (offlineErrors.length) {
      throw new Error(`offline reload reported errors:\n${offlineErrors.join("\n")}`);
    }
    await offlinePage.close();

    // Task 8: CHS ports have no offline predictions to fall back on (no
    // constituents shipped — spec §9's whole point). With the network still
    // cut, a CHS route must show the station identity and an honest "needs
    // signal" message, never a blank chart or a dead spinner. Same offline
    // browser context (same `cdp` emulation, new tab) as the NOAA check above.
    const chsErrors = [];
    const chsPage = await browser.newPage();
    chsPage.on("pageerror", (err) => chsErrors.push(`pageerror: ${err.message}`));
    chsPage.on("console", (msg) => {
      // Unlike NOAA (synchronous, no fetch), the CHS adapter genuinely tries
      // the network and is genuinely denied — Chrome logs that resource
      // failure as a console.error itself, same false-positive class as the
      // deliberate proof-fetch above. Expected here; a real app error is not.
      if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) {
        chsErrors.push(`console.error: ${msg.text()}`);
      }
    });
    const chsCdp = await chsPage.createCDPSession();
    await chsCdp.send("Network.enable");
    await chsCdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await chsPage.goto(`${URL}tide/chs-victoria`, { waitUntil: "domcontentloaded" });

    await chsPage.waitForSelector(".place h1", { timeout: 10_000 });
    const chsStationName = await chsPage.$eval(".place h1", (el) => el.textContent);
    if (!chsStationName) throw new Error("CHS offline: no station identity rendered");

    // Not a blank chart, not a hanging spinner: the honest "needs signal"
    // copy from App.tsx's offline branch, or the page never resolves out of
    // "loading" — either way this selector is the proof, not a timeout.
    await chsPage.waitForSelector(".reading.chs-signal", { timeout: 10_000 });
    const chsSignalText = await chsPage.$eval(".reading.chs-signal", (el) => el.textContent);
    if (!/needs a moment of signal/i.test(chsSignalText ?? "")) {
      throw new Error(`CHS offline: expected the "needs signal" message, got: ${JSON.stringify(chsSignalText)}`);
    }
    // No chart panel renders without a TideState — confirms this is the
    // degraded state, not a slow-but-successful render.
    const chsChartCount = (await chsPage.$$(".chart")).length;
    if (chsChartCount !== 0) throw new Error("CHS offline: a chart rendered with no data — expected none");

    if (chsErrors.length) {
      throw new Error(`CHS offline page reported errors:\n${chsErrors.join("\n")}`);
    }
    await chsPage.close();

    // Regression guard: the CHS route above must not have broken NOAA's
    // offline render (e.g. a shared code path throwing). Fresh tab, same cut
    // network, a plain NOAA station.
    const noaaErrors = [];
    const noaaPage = await browser.newPage();
    noaaPage.on("pageerror", (err) => noaaErrors.push(`pageerror: ${err.message}`));
    noaaPage.on("console", (msg) => {
      if (msg.type() === "error") noaaErrors.push(`console.error: ${msg.text()}`);
    });
    const noaaCdp = await noaaPage.createCDPSession();
    await noaaCdp.send("Network.enable");
    await noaaCdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await noaaPage.goto(`${URL}tide/friday-harbor`, { waitUntil: "domcontentloaded" });

    await noaaPage.waitForSelector(".place h1", { timeout: 10_000 });
    const noaaStationName = await noaaPage.$eval(".place h1", (el) => el.textContent);
    if (noaaStationName !== "Friday Harbor") {
      throw new Error(`NOAA offline regression: expected Friday Harbor, got: ${JSON.stringify(noaaStationName)}`);
    }
    const noaaHeight = await noaaPage.$eval(".reading .value", (el) => el.textContent);
    if (!/\d/.test(noaaHeight ?? "")) {
      throw new Error(`NOAA offline regression: expected a tide height, got: ${JSON.stringify(noaaHeight)}`);
    }
    await noaaPage.waitForSelector(".chart", { timeout: 5_000 });

    if (noaaErrors.length) {
      throw new Error(`NOAA offline regression page reported errors:\n${noaaErrors.join("\n")}`);
    }
    await noaaPage.close();

    if (errors.length) {
      throw new Error(`page reported errors:\n${errors.join("\n")}`);
    }

    console.log(
      `smoke OK — location card "${locationTitle.trim()}", tide height "${tideHeight}", ` +
        `search reached "Everett" from ${popularCount} POPULAR stations, ` +
        `deep link rendered "${deepLinkStation}" at "${deepLinkHeight}", ` +
        `offline reload (network proved "${networkState}") rendered "${offlineStationName}" ` +
        `at "${offlineHeight}" with ${offlineEventCount} events and all 41 stations counted, ` +
        `CHS offline degraded gracefully at "${chsStationName}", ` +
        `NOAA offline regression check rendered "${noaaStationName}" at "${noaaHeight}"`,
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
