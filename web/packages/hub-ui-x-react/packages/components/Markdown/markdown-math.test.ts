import { describe, expect, it } from "vitest";
import {
  normalizeBlockMathTrailing,
  splitPendingMath,
} from "./markdown-math";

describe("normalizeBlockMathTrailing", () => {
  it("splits a trailing source citation off block math", () => {
    const src =
      "其基本传热方程为：\n$$Q=K\\cdot A\\cdot \\Delta t_{eff}=K\\cdot A\\cdot F\\cdot \\Delta t_{m}$$[Source:1-1]";
    expect(normalizeBlockMathTrailing(src)).toBe(
      "其基本传热方程为：\n$$Q=K\\cdot A\\cdot \\Delta t_{eff}=K\\cdot A\\cdot F\\cdot \\Delta t_{m}$$\n[Source:1-1]",
    );
  });

  it("splits ANY trailing content (other formats) off block math", () => {
    expect(normalizeBlockMathTrailing("$$E=mc^2$$ 注意这里")).toBe(
      "$$E=mc^2$$\n 注意这里",
    );
    expect(normalizeBlockMathTrailing("$$E=mc^2$$**加粗**")).toBe(
      "$$E=mc^2$$\n**加粗**",
    );
    expect(normalizeBlockMathTrailing("$$x$$ [链接](url)")).toBe(
      "$$x$$\n [链接](url)",
    );
    expect(normalizeBlockMathTrailing("$$Q=1$$[引用:2-3]")).toBe(
      "$$Q=1$$\n[引用:2-3]",
    );
  });

  it("leaves standalone block math untouched", () => {
    const src = "$$E=mc^2$$\n下一行";
    expect(normalizeBlockMathTrailing(src)).toBe(src);
  });

  it("leaves a line with multiple $$ (inline-treated) untouched", () => {
    // 两个 $$...$$：插件走行内数学，能正常闭合，不应被强行拆分
    const src = "$$A$$ $$B$$";
    expect(normalizeBlockMathTrailing(src)).toBe(src);
  });

  it("ignores content inside code fences", () => {
    const src = "```js\n$$foo$$ bar\n```\n\n$$x$$tail";
    const out = normalizeBlockMathTrailing(src);
    // 围栏内的 $$ 不变
    expect(out).toContain("$$foo$$ bar");
    // 围栏外的数学尾随被拆分
    expect(out).toContain("$$x$$\ntail");
  });

  it("leaves inline math in running text untouched", () => {
    const src = "行内公式 $x=1$ 之后 [Source:1-1] 结束";
    expect(normalizeBlockMathTrailing(src)).toBe(src);
  });
});

describe("splitPendingMath", () => {
  it("balanced content → no pending", () => {
    expect(splitPendingMath("公式：$$Q=x$$ 即")).toEqual({
      safe: "公式：$$Q=x$$ 即",
      pending: "",
    });
  });

  it("unclosed block math → tail held as pending", () => {
    expect(splitPendingMath("公式：$$Q=K\\cdot A")).toEqual({
      safe: "公式：",
      pending: "$$Q=K\\cdot A",
    });
  });

  it("unclosed inline math → tail held as pending", () => {
    expect(splitPendingMath("前文 $x_{")).toEqual({
      safe: "前文 ",
      pending: "$x_{",
    });
  });

  it("block math closes later → whole string safe", () => {
    expect(splitPendingMath("$a$ $$b$$ c")).toEqual({
      safe: "$a$ $$b$$ c",
      pending: "",
    });
  });

  it("multiple blocks, last one unclosed → held from that block", () => {
    expect(splitPendingMath("$$a$$ 中间 $$b\\sum")).toEqual({
      safe: "$$a$$ 中间 ",
      pending: "$$b\\sum",
    });
  });

  it("escaped dollar is not treated as a delimiter", () => {
    expect(splitPendingMath("价格 \\$5 结束")).toEqual({
      safe: "价格 \\$5 结束",
      pending: "",
    });
  });

  it("empty input → both empty", () => {
    expect(splitPendingMath("")).toEqual({ safe: "", pending: "" });
  });
});