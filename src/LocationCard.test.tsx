import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LocationCard } from "./LocationCard";

// A located station never reaches this component — StationList renders it
// through the same GroupCard path as the list groups (see StationList.test).
describe("LocationCard", () => {
  // Default (permission unknown until the async Permissions query resolves —
  // which SSR never runs): the honest state is "we haven't asked yet", so offer
  // the ask inline rather than sending anyone to settings they may not need.
  it("offers an inline ask when not located, instead of a settings lecture", () => {
    const html = renderToStaticMarkup(<LocationCard onRequestLocation={() => {}} />);
    expect(html).toContain("See stations near you");
    expect(html).toContain("Use my location");
    // A real ask button that triggers a prompt — never a fake "open settings"
    // link to a screen the web has no API to reach.
    expect(html.toLowerCase()).not.toContain("open settings");
    // Without the ask handler there is nothing to offer, so no button.
    const noHandler = renderToStaticMarkup(<LocationCard />);
    expect(noHandler).not.toContain("Use my location");
  });
});
