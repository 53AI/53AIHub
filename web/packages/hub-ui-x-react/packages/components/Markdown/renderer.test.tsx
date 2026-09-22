import { describe, expect, it } from "vitest";
import { applySourceReferences, renderSourceMarkup } from "./source-markup";

describe("MdRenderer source references", () => {
  it("removes bare chunk citations instead of displaying internal tags", () => {
    const html = renderSourceMarkup(
      "结算单价偏低[source:c000][source:c000][source:c000]。",
    );

    expect(html).toBe("结算单价偏低。");
  });

  it("removes other unrecognized source tags as a safe fallback", () => {
    expect(renderSourceMarkup("正文[source: file:123#c000]。"))
      .toBe("正文。");
    expect(renderSourceMarkup("正文[sourcc001]。"))
      .toBe("正文。");
    expect(renderSourceMarkup("正文[Source:G\\_9\\_0]。"))
      .toBe("正文。");
  });

  it("removes unresolved wiki links from Q&A text", () => {
    expect(
      renderSourceMarkup(
        "[[concept/technical\\_consulting\\_lead\\_generation\\ &#x20; 分区计量]]）与设备交付",
      ),
    ).toBe("）与设备交付");
  });

	it("keeps valid source citations as reference markup", () => {
    const html = renderSourceMarkup(
      "依据[Source:1-2]。",
      (sourceType, sourceNumber) => `${sourceType}-${sourceNumber}`,
    );

    expect(html).toContain(
      '<span class="source-reference" data-source-type="1" data-source-number="2">1-2</span>',
    );
	});

	it("renders only source ids present in the current message", () => {
		const html = renderSourceMarkup(
			"依据[Source:1-2][source:g-1][Source:9-9]。",
			(sourceType, sourceNumber) => `${sourceType}-${sourceNumber}`,
			undefined,
			["1-2", "G-1"],
		);

		expect(html).toContain("1-2");
		expect(html).toContain("g-1");
		expect(html).not.toContain("9-9");
	});

  it("does not alter bare chunk citations inside code blocks", () => {
    expect(applySourceReferences("```text\n[source:c000]\n```", undefined)).toBe(
      "```text\n[source:c000]\n```",
    );
  });
});
