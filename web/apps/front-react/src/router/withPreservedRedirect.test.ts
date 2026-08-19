import { describe, expect, it } from "vitest";

import { withPreservedRedirect } from "./index";

describe("withPreservedRedirect", () => {
  it("returns target unchanged when currentSearch has no redirect", () => {
    expect(withPreservedRedirect("/agent", "")).toBe("/agent");
    expect(withPreservedRedirect("/agent", "?foo=bar")).toBe("/agent");
  });

  it("forwards redirect param onto target query", () => {
    expect(withPreservedRedirect("/agent", "?redirect=/skills/abc")).toBe(
      "/agent?redirect=%2Fskills%2Fabc",
    );
  });

  it("preserves redirect value verbatim inside the new query", () => {
    expect(
      withPreservedRedirect("/agent", "?redirect=/skills/abc#section"),
    ).toBe("/agent?redirect=%2Fskills%2Fabc%23section");
  });

  it("preserves the outer-URL hash through the redirect chain", () => {
    // User lands on /?redirect=/skills/abc#section1, RootRedirect sends them
    // to /index?redirect=/skills/abc#section1 — the #section1 must survive.
    expect(
      withPreservedRedirect("/index", "?redirect=/skills/abc", "#section1"),
    ).toBe("/index?redirect=%2Fskills%2Fabc#section1");
  });

  it("drops the outer hash cleanly when not provided", () => {
    expect(withPreservedRedirect("/index", "?redirect=/skills/abc")).toBe(
      "/index?redirect=%2Fskills%2Fabc",
    );
  });

  it("preserves other query params from target alongside redirect", () => {
    expect(
      withPreservedRedirect("/index?keep=1", "?redirect=/skills/abc"),
    ).toBe("/index?redirect=%2Fskills%2Fabc&keep=1");
  });

  it("currentSearch redirect wins over any redirect baked into target", () => {
    expect(
      withPreservedRedirect("/index?redirect=/old", "?redirect=/new"),
    ).toBe("/index?redirect=%2Fnew");
  });
});