import { describe, expect, it } from "vitest";
import { isWecomUserAgent } from "@/utils/browser-env";

const UA = {
  wecomDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 wxwork/4.1.10 MicroMessenger/7.0.1 Language/zh ColorScheme/Light",
  wecomIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 wxwork/4.1.10 MicroMessenger/7.0.1 Language/zh",
  wecomAndroid:
    "Mozilla/5.0 (Linux; Android 13; PGT-AN10 Build/HONORPGT-AN10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/107.0.0.0 Mobile Safari/537.36 wxwork/4.1.10 MicroMessenger/7.0.1 Language/zh",
  wecomUpper: "WXWork/4.1.10 MicroMessenger/7.0.1",
  wechatOnly:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x1800282a) NetType/WIFI Language/zh_CN",
  chrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  safari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
};

describe("isWecomUserAgent", () => {
  it("识别企业微信内置浏览器（桌面 / iOS / Android / 大写）", () => {
    expect(isWecomUserAgent(UA.wecomDesktop)).toBe(true);
    expect(isWecomUserAgent(UA.wecomIOS)).toBe(true);
    expect(isWecomUserAgent(UA.wecomAndroid)).toBe(true);
    expect(isWecomUserAgent(UA.wecomUpper)).toBe(true);
  });

  it("普通微信不算企业微信浏览器（isInQw 在这里会误判）", () => {
    expect(isWecomUserAgent(UA.wechatOnly)).toBe(false);
  });

  it("普通浏览器不算", () => {
    expect(isWecomUserAgent(UA.chrome)).toBe(false);
    expect(isWecomUserAgent(UA.safari)).toBe(false);
    expect(isWecomUserAgent("")).toBe(false);
  });
});
