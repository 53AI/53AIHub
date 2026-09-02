import { describe, expect, it } from "vitest";
import { buildPageListParams } from "./useWikiPageList";

describe("buildPageListParams", () => {
  const base = {
    pageType: "concept" as const,
    offset: 0,
    limit: 30,
    sortBy: "updated_time" as const,
    sortOrder: "desc" as const,
  };

  it("按标签浏览（无关键词）时携带 page_type，不带 keyword", () => {
    const params = buildPageListParams({ ...base, keyword: "" });
    expect(params.page_type).toBe("concept");
    expect(params.keyword).toBeUndefined();
    expect(params).toMatchObject({
      offset: 0,
      limit: 30,
      sort_by: "updated_time",
      sort_order: "desc",
    });
  });

  it("选中分类时携带 category_id，未选时不带", () => {
    const withCat = buildPageListParams({ ...base, keyword: "", categoryId: 7 });
    expect(withCat.category_id).toBe(7);

    const withoutCat = buildPageListParams({ ...base, keyword: "" });
    expect(withoutCat.category_id).toBeUndefined();
  });

  it("category_id 为 0（「其他」虚拟分类）时改传 other", () => {
    const params = buildPageListParams({ ...base, keyword: "", categoryId: 0 });
    expect(params.category_id).toBe("other");
  });

  it("选中分类且未传 page_type 时，仅携带 category_id", () => {
    const params = buildPageListParams({
      ...base,
      pageType: undefined,
      keyword: "",
      categoryId: 2,
    });
    expect(params.category_id).toBe(2);
    expect(params.page_type).toBeUndefined();
  });

  it("有关键词时全局搜索：携带 keyword，忽略 page_type", () => {
    const params = buildPageListParams({ ...base, keyword: "  hello  " });
    expect(params.keyword).toBe("hello");
    expect(params.page_type).toBeUndefined();
  });

  it("有关键词时忽略 category_id（全局搜索）", () => {
    const params = buildPageListParams({
      ...base,
      keyword: "hello",
      categoryId: 7,
    });
    expect(params.keyword).toBe("hello");
    expect(params.category_id).toBeUndefined();
    expect(params.page_type).toBeUndefined();
  });

  it("关键词仅空白视为无关键词，按标签浏览", () => {
    const params = buildPageListParams({ ...base, keyword: "   " });
    expect(params.page_type).toBe("concept");
    expect(params.keyword).toBeUndefined();
  });

  it("透传分页与排序参数", () => {
    const params = buildPageListParams({
      ...base,
      keyword: "",
      offset: 60,
      limit: 30,
      sortBy: "created_time",
      sortOrder: "asc",
    });
    expect(params).toMatchObject({
      offset: 60,
      limit: 30,
      sort_by: "created_time",
      sort_order: "asc",
    });
  });
});
