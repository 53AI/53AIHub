import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/modules/files/transform", () => ({
  formatFileInfo: (name: string) => ({ fname: name.replace(/\.pdf$/i, ""), icon: "" }),
}));

import {
  sanitizeSearchHighlight,
  sanitizeSearchContent,
  transformResult,
} from "../transform";
import type { GlobalSearchResultItem } from "@/api/modules/global-search/types";

const baseItem: GlobalSearchResultItem = {
  file_id: "f1",
  file_name: "【推介材料】黑翼陆享优选成长5号私募证券投资基金.pdf",
  path: "/a/b.pdf",
  library_id: "l1",
  library_name: "库",
  space_id: "s1",
  space_name: "空间",
  creator_id: 1,
  creator_name: "张三",
  latest_file_body_update_time: 1700000000000,
  isfolder: false,
};

describe("sanitizeSearchHighlight", () => {
  it("空值返回 undefined", () => {
    expect(sanitizeSearchHighlight(undefined)).toBeUndefined();
    expect(sanitizeSearchHighlight("")).toBeUndefined();
  });

  it("保留 <mark> 标签并转义其余 HTML", () => {
    expect(
      sanitizeSearchHighlight(
        "【推介材料】黑翼陆享优选成长5号私募证券投资<mark>基</mark><mark>金</mark>.pdf",
      ),
    ).toBe(
      "【推介材料】黑翼陆享优选成长5号私募证券投资<mark>基</mark><mark>金</mark>.pdf",
    );
  });

  it("剥离开标记属性，仅保留语义标签", () => {
    expect(
      sanitizeSearchHighlight("投资<mark class=\"hl\">基金</mark><script>alert(1)</script>.pdf"),
    ).toBe("投资<mark>基金</mark>&lt;script&gt;alert(1)&lt;/script&gt;.pdf");
  });
});

describe("sanitizeSearchContent", () => {
  it("保留 <mark> 高亮", () => {
    expect(
      sanitizeSearchContent("益州<mark>牧</mark>治理一方"),
    ).toBe("益州<mark>牧</mark>治理一方");
  });

  it("把 [[entity/slug|label]] 还原为纯文本 label", () => {
    expect(
      sanitizeSearchContent("张鲁在[[entity/hanzhong|汉中]]自立"),
    ).toBe("张鲁在汉中自立");
  });

  it("把 [[slug]] 还原为 slug 文本", () => {
    expect(
      sanitizeSearchContent("参见[[益州牧]]条"),
    ).toBe("参见益州牧条");
  });

  it("转义其余 HTML，防止注入", () => {
    expect(
      sanitizeSearchContent("对抗<mark>曹操</mark><script>alert(1)</script>扩张"),
    ).toBe("对抗<mark>曹操</mark>&lt;script&gt;alert(1)&lt;/script&gt;扩张");
  });

  it("空值返回 undefined", () => {
    expect(sanitizeSearchContent(undefined)).toBeUndefined();
    expect(sanitizeSearchContent("")).toBeUndefined();
  });
});

describe("transformResult", () => {
  it("透传后端 highlight 到展示项", () => {
    const out = transformResult({
      ...baseItem,
      highlight: "私募证券投资<mark>基金</mark>.pdf",
    });
    expect(out.highlight).toBe("私募证券投资<mark>基金</mark>.pdf");
  });

  it("透传后端 content_highlight 到展示项", () => {
    const out = transformResult({
      ...baseItem,
      content_highlight: "益州牧治理<mark>一方</mark>",
    });
    expect(out.content_highlight).toBe("益州牧治理<mark>一方</mark>");
  });

  it("无 highlight 时字段为 undefined", () => {
    const out = transformResult(baseItem);
    expect(out.highlight).toBeUndefined();
  });
});