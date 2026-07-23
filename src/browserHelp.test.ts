import { describe, it, expect } from "vitest";
import { detectBrowserHelp } from "./browserHelp";

// Real-ish UA strings. The order in detectBrowserHelp matters: Chrome's UA
// contains "Safari", iPhone Chrome contains "CriOS", so these guard the
// precedence, not just the happy path.
const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  safariIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  chromeIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1",
  firefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  edge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0",
};

describe("detectBrowserHelp", () => {
  it("names Chrome for a Chrome UA (not Safari, despite the token)", () => {
    expect(detectBrowserHelp(UA.chromeMac).name).toBe("Chrome");
  });

  it("names Safari only for real Safari", () => {
    expect(detectBrowserHelp(UA.safariMac).name).toBe("Safari");
  });

  it("routes any iOS browser to the iOS steps", () => {
    expect(detectBrowserHelp(UA.safariIOS).name).toMatch(/iPhone/);
    expect(detectBrowserHelp(UA.chromeIOS).name).toMatch(/iPhone/);
  });

  it("treats a touch Mac (iPadOS masquerade) as iOS", () => {
    expect(detectBrowserHelp(UA.safariMac, 5).name).toMatch(/iPhone/);
    // ...but a real Mac (no touch) stays desktop Safari.
    expect(detectBrowserHelp(UA.safariMac, 0).name).toBe("Safari");
  });

  it("names Firefox", () => {
    expect(detectBrowserHelp(UA.firefox).name).toBe("Firefox");
  });

  it("falls back to Chrome's path for other Chromium browsers (Edge)", () => {
    expect(detectBrowserHelp(UA.edge).name).toBe("Chrome");
  });

  it("always returns three actionable steps ending in Try again", () => {
    for (const ua of Object.values(UA)) {
      const help = detectBrowserHelp(ua);
      expect(help.steps.length).toBe(3);
      expect(help.steps.at(-1)).toMatch(/Try again/);
    }
  });
});
