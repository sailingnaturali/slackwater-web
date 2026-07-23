export type BrowserHelp = { name: string; steps: string[] };

/**
 * Per-browser path to reverse a *blocked* location permission. Once a user
 * blocks the ask, the browser won't prompt again — the setting has to be
 * changed by hand, and every browser hides it somewhere different.
 *
 * Pure over the UA string (and touch-point count) so it's testable without a
 * real navigator. There's no maintained npm package for these paths (checked),
 * and they drift with browser releases — treat the copy below as a calibration
 * knob: when a browser moves its Location setting, edit the steps here.
 *
 * We only distinguish the four the request named; everything Chromium (Chrome,
 * Edge, Brave, Opera, Android) shares Chrome's site-settings path, so that's
 * also the sensible fallback for anything unrecognised.
 */
export function detectBrowserHelp(ua: string, maxTouchPoints = 0): BrowserHelp {
  // iPadOS reports as "Macintosh" but is a touch device — treat it as iOS.
  const isIOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  const isFirefox = /Firefox|FxiOS/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrom(e|ium)|Android|Edg/.test(ua);

  if (isIOS) {
    return {
      name: "Safari on iPhone or iPad",
      steps: [
        'Tap the page-settings icon ("AA" or ⋯) at the edge of the address bar.',
        "Choose Website Settings, then set Location to Ask or Allow.",
        "Come back here and tap Try again.",
      ],
    };
  }
  if (isFirefox) {
    return {
      name: "Firefox",
      steps: [
        "Open Settings → Privacy & Security → Permissions → Location → Settings.",
        "Find this site and set it to Allow, or remove it from the list.",
        "Come back here and tap Try again.",
      ],
    };
  }
  if (isSafari) {
    return {
      name: "Safari",
      steps: [
        "From the menu bar, open Safari → Settings for This Website.",
        "Set Location to Ask or Allow.",
        "Come back here and tap Try again.",
      ],
    };
  }
  return {
    name: "Chrome",
    steps: [
      "Open Settings → Privacy and security → Site settings → Location.",
      'Find this site under "Not allowed to see your location" and switch it to Ask, or remove it with the trash icon.',
      "Come back here and tap Try again.",
    ],
  };
}
