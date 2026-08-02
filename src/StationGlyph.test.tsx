import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StationGlyph } from "./StationGlyph";

const render = (kind: "tide" | "current", tone: string) =>
  renderToStaticMarkup(<StationGlyph kind={kind} tone={tone as never} />);

// The shape of the path data is what distinguishes kind; the class is what
// distinguishes state. Compare the <path d="..."> set, not the whole markup.
const paths = (html: string) => [...html.matchAll(/d="([^"]+)"/g)].map((m) => m[1]).join("|");
const toneClass = (html: string) => html.match(/class="station-glyph (\w+)"/)![1];

describe("StationGlyph — colour is state, form is kind", () => {
  it("gives the same colour to different kinds in the same state", () => {
    const tide = render("tide", "slack");
    const current = render("current", "slack");
    expect(toneClass(tide)).toBe(toneClass(current));
    expect(paths(tide)).not.toBe(paths(current));
  });

  it("gives the same form to one kind across different states", () => {
    const flood = render("current", "flood");
    const ebb = render("current", "ebb");
    expect(paths(flood)).toBe(paths(ebb));
    expect(toneClass(flood)).not.toBe(toneClass(ebb));
  });

  it("falls back to a neutral tone when state is unknown", () => {
    expect(toneClass(render("tide", "unknown"))).toBe("unknown");
  });
});
