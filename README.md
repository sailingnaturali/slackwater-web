# Slackwater (web)

Tide predictions for the Salish Sea that work with **no signal**. Open it once, install it to
your home screen, and it keeps answering in an anchorage with no bars — the harmonics are
computed on your device, not fetched.

**[slackwater.sailingnaturali.com](https://slackwater.sailingnaturali.com)**

This is the web build. It is the interim answer to "is there an Android version", and the live
proof for the iOS app — same data, same engine lineage, no account and no server.

## How it works

Tide prediction is deterministic astronomy, not a live feed. Given a station's harmonic
constituents you can compute heights for any minute, years ahead, offline. This app bundles
the constituents, computes with [`@neaps/tide-predictor`](https://github.com/openwatersio/neaps),
and ships as an installable PWA with everything precached.

There is no backend. Hosting is GitHub Pages, so there is nothing to keep paying for and
nothing to go down — which is the point for a tool you want to still work in five years.

## What ships, and what deliberately does not

The bundle carries **public-domain NOAA stations only** (`scripts/build-stations.mjs`).

The upstream database also holds cc-by-4.0 stations derived from TICON/UHSLC — which is
*every Canadian station in this region*. Those are computed against the current epoch rather
than the agency's adopted chart datum, and drift from it by roughly 0.2–0.4 m on this coast.
Shipping them would put confident-looking numbers in exactly the water this app is for.

So Canadian coverage is coming from CHS online instead, marked at lower confidence. The
licence filter runs in CI on every build rather than once on a laptop, and there is a test
asserting nothing else got in.

## Design

Type, palette and idiom come from the Sailing Naturali design system — Fraunces display,
Geist body, Geist Mono eyebrows in uppercase with wide tracking, navy and forest green on
warm paper, hairline borders and flat bands rather than card shadows. The water ramp behind
the first-run screen and the green hairline rule are lifted from `web/src/styles.css` so the
charter site and this app read as one brand.

Two deliberate departures:

- **Fonts are self-hosted**, where the web repo `@import`s them from Google. A webfont
  request would be a network dependency in an app whose promise is not needing one.
- **There is a dark scheme.** The house style is paper-white; this gets read at 05:00 in a
  cockpit, where that destroys night vision. Dark mode uses the dark end of the same water
  ramp — same palette, same type, inverted ground — and follows the device setting.

## Station match quality

Ask for tides at a place rather than a station and something has to decide which station
answers. Distance alone is not enough: the tide can turn at visibly different times on either
side of a pass. So the app compares **M2 phase across the nearest few stations** — if they
disagree, the neighbourhood genuinely varies and no snap is labelled a good match, however
close it is. Standing on the station itself is always a good match, because there is no snap
to get wrong.

## Develop

```sh
npm install
npm run dev      # regenerates the station bundle, then serves
npm test
```

`src/data/stations.json` is generated and gitignored.

---

Astronomical tide prediction only — **not for navigation**. GPL-3.0-or-later.
Part of [Sailing Naturali](https://sailingnaturali.com).
