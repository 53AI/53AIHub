import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixTableColumns } from "./markdown-fix-table";

const TEST_TXT_PATH = path.resolve(
  __dirname,
  "../../../../shared-business/src/chat/components/message/test.txt",
);

function loadTestTxt(): string {
  return fs.readFileSync(TEST_TXT_PATH, "utf8");
}

describe("fixTableColumns", () => {
  // 关键回归：test.txt 之前会让整个 chat 渲染卡死。
  // 分隔符行 |---...---|---...---| 触发了 renderer.tsx 旧实现的
  // /^\|\s*[-:]+(\s*[-:]+)*\s*\|$/ 灾难性回溯，单次 .test() 就会让
  // 主线程死锁 15 秒以上。
  it(
    "returns within 1s for test.txt (regression: catastrophic backtracking in separator detection)",
    () => {
      const content = loadTestTxt();
      const t0 = performance.now();
      const out = fixTableColumns(content);
      const dt = performance.now() - t0;
      expect(dt).toBeLessThan(1000);
      // 不应该改变内容，因为 test.txt 的表头已经对齐（无修复需求）
      expect(out).toBe(content);
    },
    3000,
  );

  it("returns content unchanged when there are no pipe characters", () => {
    const input = "hello world\nno table here";
    expect(fixTableColumns(input)).toBe(input);
  });

  it("returns content unchanged when all tables are well-formed", () => {
    const input = [
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "| 3 | 4 |",
    ].join("\n");
    expect(fixTableColumns(input)).toBe(input);
  });

  it("pads header and separator when a body row has more cells than the header", () => {
    const input = [
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 | 3 |",
    ].join("\n");
    const out = fixTableColumns(input);
    // 保留原实现语义：
    //   header:    line.substring(0, lastPipeIndex) + (" |".repeat(N)) + " |"
    //   separator: line.substring(0, lastPipeIndex) + (" | ---".repeat(N)) + " |"
    // N=1 时：
    //   header:    "| a | b " + " |" + " |"           = "| a | b  | |"
    //   separator: "| --- | --- " + " | ---" + " |"   = "| --- | ---  | --- |"
    expect(out).toContain("| a | b  | |");
    expect(out).toContain("| --- | ---  | --- |");
  });
});
