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

// The offline-sync background prefetch fires CHS/IWLS fetches on every page
// mount. In CI the runner can't reach api-iwls.dfo-mpo.gc.ca (and under the
// offline-emulation blocks the fetch is cut on purpose), so Chrome logs the
// failed request as a console.error the app cannot suppress — the app catches
// the rejection and marks that download failed. This browser-level resource
// noise is not an app error. pageerror is never filtered, so a real render
// crash still fails the smoke. (Supersedes the per-block ERR_INTERNET_DISCONNECTED
// filters the CHS offline checks used before the prefetch existed.)
const IWLS_HOST = "api-iwls.dfo-mpo.gc.ca";
// Seascape bathymetry tiles + glyph PBFs stream from this host (see
// MapScreen.tsx); unreachable in CI/sandbox the same way IWLS is — the map
// is built to degrade to its local land-only fallback style when this fails,
// so a failed fetch to it is not an app error either.
const SEASCAPE_HOST = "tiles.openwaters.io";
function isChsFetchNoise(text) {
  return (
    text.includes(IWLS_HOST) ||
    text.includes(SEASCAPE_HOST) ||
    /blocked by CORS policy/.test(text) ||
    /Failed to load resource: net::ERR_(FAILED|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_REFUSED|TIMED_OUT|ADDRESS_UNREACHABLE)/.test(
      text,
    )
  );
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
    // Fix 1: land.pmtiles must render offline via the workbox runtime Range
    // route (see vite.config.ts's runtimeCaching entry), not the Workbox
    // precache — a precache response is a plain 200 with the full body and no
    // Range support, but pmtiles reads the archive with Range requests and
    // requires 206. Load /map ONLINE first so the SW installs and takes
    // control and main.tsx's warm-fetch pulls land.pmtiles into the runtime
    // Range cache, then cut the network at the CDP level and reload — MapLibre
    // must still boot on the cached pmtiles. Before Fix 1, the pmtiles range
    // read against the SW's precached 200 throws a same-origin /land.pmtiles
    // error here (not tile-host noise), so this assertion fails without the
    // fix and passes with it. Seascape bathymetry + glyphs are still external
    // and expected to fail either way (filtered as isChsFetchNoise); waiting
    // for the canvas MapLibre actually draws to is proof the map booted on its
    // offline-capable fallback, not just that the container div mounted.
    // pageerror stays unfiltered — a real MapLibre crash must still fail the
    // smoke.
    const mapErrors = [];
    const mapPage = await browser.newPage();
    // First load installs the service worker but does NOT control this page yet
    // (registerType 'prompt' → no clientsClaim; a SW only controls navigations
    // that start after it activates). So map + land here come straight from the
    // network, uncached.
    await mapPage.goto(`${URL}map`, { waitUntil: "domcontentloaded" });
    await mapPage.waitForSelector(".map-canvas .maplibregl-canvas", { timeout: 10_000 });
    await mapPage.evaluate(() => navigator.serviceWorker.ready);

    // Reload: NOW the active SW controls the page, so main.tsx's warm-fetch and
    // the map's own pmtiles reads go through the runtime Range route and land
    // land.pmtiles in the "land-pmtiles" cache — which is what makes the offline
    // reload below able to draw coastline. Reloading before the SW controls the
    // page would just prove the runtime route was never in the loop.
    await mapPage.reload({ waitUntil: "domcontentloaded" });
    await mapPage.waitForSelector(".map-canvas .maplibregl-canvas", { timeout: 10_000 });
    await mapPage.waitForFunction(() => navigator.serviceWorker.controller != null, {
      timeout: 15_000,
    });
    await mapPage.waitForFunction(
      async () => (await (await caches.open("land-pmtiles")).match("/land.pmtiles")) != null,
      { timeout: 15_000 },
    );

    const mapCdp = await mapPage.createCDPSession();
    await mapCdp.send("Network.enable");
    await mapCdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });

    // Prove the network is really down before trusting the reload below (see
    // the offline-reload check further down — navigator.onLine lies under
    // this exact emulation).
    const mapNetworkState = await mapPage.evaluate(() =>
      fetch("https://example.com/" + Math.random())
        .then(() => "UP")
        .catch(() => "down"),
    );
    if (mapNetworkState !== "down") {
      throw new Error(`/map network emulation did not take effect: fetch reported "${mapNetworkState}"`);
    }

    // Listeners attach only now, same reasoning as the main offline-reload
    // check below: the proof fetch above deliberately targets an unreachable
    // origin and Chrome logs its own resource-load error for that regardless
    // of the JS-level .catch() — a false positive if counted as an app error.
    mapPage.on("pageerror", (err) => mapErrors.push(`pageerror: ${err.message}`));
    mapPage.on("console", (msg) => {
      if (msg.type() === "error" && !isChsFetchNoise(msg.text())) mapErrors.push(`console.error: ${msg.text()}`);
    });

    await mapPage.reload({ waitUntil: "domcontentloaded" });
    // This is the assertion Fix 1 exists for: before the runtime Range route,
    // the pmtiles read against the SW's precached (Range-less) response
    // throws before MapLibre ever gets a canvas up.
    await mapPage.waitForSelector(".map-canvas .maplibregl-canvas", { timeout: 10_000 });
    if (mapErrors.length) {
      throw new Error(`/map offline reload reported errors:\n${mapErrors.join("\n")}`);
    }
    await mapPage.close();

    const page = await browser.newPage();
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !isChsFetchNoise(msg.text())) errors.push(`console.error: ${msg.text()}`);
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
    await page.waitForSelector(".location-card .location-title", { timeout: 5_000 });

    const locationTitle = await page.$eval(
      ".location-card .location-title",
      (el) => el.textContent,
    );
    // Declining doesn't blank the sidebar: CURRENT LOCATION renders a real
    // title either way. Which one depends on the browser's geolocation
    // permission — "Location blocked" when denied (headless default), the ask
    // when still promptable — so accept either. The invariant is "not empty".
    const VALID_TITLES = ["Location blocked", "See stations near you"];
    if (!VALID_TITLES.includes(locationTitle?.trim())) {
      throw new Error(`expected a location card title, got: ${JSON.stringify(locationTitle)}`);
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
      if (msg.type() === "error" && !isChsFetchNoise(msg.text())) deepLinkErrors.push(`console.error: ${msg.text()}`);
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
      if (msg.type() === "error" && !isChsFetchNoise(msg.text())) offlineErrors.push(`console.error: ${msg.text()}`);
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
      if (msg.type() === "error" && !isChsFetchNoise(msg.text())) {
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

    // Task 11: current gates (Active Pass etc.) are identity-only too — no
    // constituents shipped, same offline contract as a CHS tide port. Same
    // pattern as the chsPage block above: fresh tab, same cut network.
    const gateErrors = [];
    const gatePage = await browser.newPage();
    gatePage.on("pageerror", (err) => gateErrors.push(`pageerror: ${err.message}`));
    gatePage.on("console", (msg) => {
      if (msg.type() === "error" && !isChsFetchNoise(msg.text())) {
        gateErrors.push(`console.error: ${msg.text()}`);
      }
    });
    const gateCdp = await gatePage.createCDPSession();
    await gateCdp.send("Network.enable");
    await gateCdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await gatePage.goto(`${URL}tide/chs-active-pass`, { waitUntil: "domcontentloaded" });
    await gatePage.waitForSelector(".place h1", { timeout: 10_000 });
    const gateName = await gatePage.$eval(".place h1", (el) => el.textContent);
    if (gateName !== "Active Pass") throw new Error(`CHS gate offline: expected Active Pass, got ${JSON.stringify(gateName)}`);
    await gatePage.waitForSelector(".reading.chs-signal", { timeout: 10_000 });
    const gateSignalText = await gatePage.$eval(".reading.chs-signal", (el) => el.textContent);
    if (!/needs a moment of signal/i.test(gateSignalText ?? "")) {
      throw new Error(`CHS gate offline: expected the "needs signal" message, got: ${JSON.stringify(gateSignalText)}`);
    }
    if ((await gatePage.$$(".chart")).length !== 0) throw new Error("CHS gate offline: a chart rendered with no data — expected none");
    if (gateErrors.length) throw new Error(`CHS gate offline page reported errors:\n${gateErrors.join("\n")}`);
    await gatePage.close();

    // Regression guard: the CHS route above must not have broken NOAA's
    // offline render (e.g. a shared code path throwing). Fresh tab, same cut
    // network, a plain NOAA station.
    const noaaErrors = [];
    const noaaPage = await browser.newPage();
    noaaPage.on("pageerror", (err) => noaaErrors.push(`pageerror: ${err.message}`));
    noaaPage.on("console", (msg) => {
      if (msg.type() === "error" && !isChsFetchNoise(msg.text())) noaaErrors.push(`console.error: ${msg.text()}`);
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
        `/map booted MapLibre with a real canvas, ` +
        `offline reload (network proved "${networkState}") rendered "${offlineStationName}" ` +
        `at "${offlineHeight}" with ${offlineEventCount} events and all 41 stations counted, ` +
        `CHS offline degraded gracefully at "${chsStationName}", ` +
        `CHS gate offline degraded gracefully at "${gateName}" with no chart, ` +
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
