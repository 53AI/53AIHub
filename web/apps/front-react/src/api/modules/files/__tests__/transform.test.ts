import { describe, it, expect } from "vitest";
import { buildFileTree, formatFileSearchResult } from "../transform";
import type { TreeBuildNode } from "../types";

/** 测试用节点：buildFileTree 只要求 TreeBuildNode，额外字段用于断言排序依据 */
type TestFile = TreeBuildNode & { created_time?: number; name?: string };

const treeKey = (node: TestFile): string => node.name || node.path;

describe("buildFileTree 排序", () => {
  it("sort 不同时按 sort 升序", () => {
    const files: TestFile[] = [
      { path: "a", base_path: "", isfolder: false, sort: 3, name: "c" },
      { path: "a", base_path: "", isfolder: false, sort: 1, name: "a" },
      { path: "a", base_path: "", isfolder: false, sort: 2, name: "b" },
    ];
    const tree = buildFileTree(files);
    expect(tree.map(treeKey)).toEqual(["a", "b", "c"]);
  });

  it("sort 相同（均为 0）时按 created_time 降序，新的在前", () => {
    const files: TestFile[] = [
      { path: "a", base_path: "", isfolder: false, sort: 0, created_time: 100, name: "old" },
      { path: "a", base_path: "", isfolder: false, sort: 0, created_time: 300, name: "new" },
      { path: "a", base_path: "", isfolder: false, sort: 0, created_time: 200, name: "mid" },
    ];
    const tree = buildFileTree(files);
    expect(tree.map(treeKey)).toEqual(["new", "mid", "old"]);
  });

  it("sort 优先于 created_time，跨 sort 值不因时间倒排", () => {
    const files: TestFile[] = [
      { path: "a", base_path: "", isfolder: false, sort: 3, created_time: 100, name: "sort3" },
      { path: "a", base_path: "", isfolder: false, sort: 0, created_time: 999, name: "sort0" },
    ];
    const tree = buildFileTree(files);
    expect(tree.map(treeKey)).toEqual(["sort0", "sort3"]);
  });

  it("嵌套层级同样生效（子项 sort 相同按 created_time 降序）", () => {
    const files: TestFile[] = [
      { path: "dir", base_path: "", isfolder: true, sort: 0, created_time: 50, name: "dir" },
      { path: "dir/a", base_path: "dir", isfolder: false, sort: 0, created_time: 100, name: "a" },
      { path: "dir/b", base_path: "dir", isfolder: false, sort: 0, created_time: 300, name: "b" },
    ];
    const tree = buildFileTree(files);
    const dir = tree.find((n) => treeKey(n) === "dir");
    expect(dir?.children?.map(treeKey)).toEqual(["b", "a"]);
  });

  it("created_time 缺失时视为 0，排在已有时间戳者之后", () => {
    const files: TestFile[] = [
      { path: "a", base_path: "", isfolder: false, sort: 0, name: "noTime" },
      { path: "a", base_path: "", isfolder: false, sort: 0, created_time: 200, name: "withTime" },
    ];
    const tree = buildFileTree(files);
    expect(tree.map(treeKey)).toEqual(["withTime", "noTime"]);
  });
});

describe("formatFileSearchResult location", () => {
  const base = {
    creator_id: 1,
    file_id: 1,
    highlight: "",
    library_id: 1,
    library_name: "知识库",
    path: "",
    score: 0,
    space_id: 1,
    space_name: "空间",
    type: 1,
    latest_file_body_update_time: 0,
  };

  it("根目录文件的 location 只含 空间/知识库（带前导斜杠不产生多余分隔）", () => {
    const result = formatFileSearchResult({ ...base, path: "/报告.md" });
    expect(result.location).toBe("空间/知识库");
  });

  it("嵌套文件把父目录路径拼到 location 之后", () => {
    const result = formatFileSearchResult({
      ...base,
      path: "/文件夹A/子文件夹/报告.md",
    });
    expect(result.location).toBe("空间/知识库/文件夹A/子文件夹");
  });

  it("前导斜杠不产生双斜杠", () => {
    const result = formatFileSearchResult({
      ...base,
      path: "/红海云/下属文件.md",
    });
    expect(result.location).toBe("空间/知识库/红海云");
    expect(result.location).not.toContain("//");
  });

  it("文件夹作为结果项时取自身的父目录作为 location 前缀", () => {
    const result = formatFileSearchResult({
      ...base,
      path: "/文件夹A",
      type: 0,
    });
    expect(result.location).toBe("空间/知识库");
  });
});