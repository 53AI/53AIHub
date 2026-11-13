import { beforeEach, describe, expect, it } from "vitest";
import {
  isOpenidLikeNickname,
  shouldPromptNicknameFix,
  markNicknamePrompted,
  NICKNAME_PROMPT_STORAGE_KEY,
} from "@/utils/nickname-prompt";

describe("isOpenidLikeNickname", () => {
  it("识别企业微信 openid", () => {
    expect(isOpenidLikeNickname("oGZUI0egBJY1zhBYw2KhdUfwVJJE")).toBe(true);
    expect(isOpenidLikeNickname("wxid_abc123def456ghi")).toBe(true);
  });
  it("正常昵称不误判", () => {
    expect(isOpenidLikeNickname("张三")).toBe(false);
    expect(isOpenidLikeNickname("Tom")).toBe(false);
    expect(isOpenidLikeNickname("")).toBe(false);
    expect(isOpenidLikeNickname(undefined)).toBe(false);
    expect(isOpenidLikeNickname("aaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(isOpenidLikeNickname("13800138000")).toBe(false);
    expect(isOpenidLikeNickname("zhang.san@corp.com")).toBe(false);
  });
});

describe("shouldPromptNicknameFix", () => {
  beforeEach(() => localStorage.clear());
  it("未提示过时返回 true", () => {
    expect(shouldPromptNicknameFix("oGZUI0egBJY1zhBYw2KhdUfwVJJE")).toBe(true);
  });
  it("7 天内不重复提示", () => {
    const n = "oGZUI0egBJY1zhBYw2KhdUfwVJJE";
    markNicknamePrompted(n);
    expect(shouldPromptNicknameFix(n)).toBe(false);
  });
  it("超过 7 天再次提示", () => {
    const n = "oGZUI0egBJY1zhBYw2KhdUfwVJJE";
    localStorage.setItem(NICKNAME_PROMPT_STORAGE_KEY, JSON.stringify({ value: n, time: Date.now() - 8 * 24 * 3600 * 1000 }));
    expect(shouldPromptNicknameFix(n)).toBe(true);
  });
  it("昵称变化后重新提示", () => {
    markNicknamePrompted("oGZUI0egBJY1zhBYw2KhdUfwVJJE");
    expect(shouldPromptNicknameFix("wxid_abc123def456ghi")).toBe(true);
  });
  it("正常昵称永不提示", () => {
    expect(shouldPromptNicknameFix("张三")).toBe(false);
  });
});
