import type { OutputFile } from "../types/message";

export type OutputFileDownloadStrategy =
  | { kind: "direct_url"; url: string }
  | { kind: "data_url"; url: string }
  | { kind: "message_lookup" }
  | { kind: "none" };

export function getOutputFileDownloadStrategy(file: OutputFile): OutputFileDownloadStrategy {
  if (file.signed_download_url) {
    return { kind: "direct_url", url: file.signed_download_url };
  }
  if (file.download_url) {
    return { kind: "direct_url", url: file.download_url };
  }
  if (file.preview_url) {
    return { kind: "direct_url", url: file.preview_url };
  }
  if (typeof file.url === "string" && file.url.startsWith("data:")) {
    return { kind: "data_url", url: file.url };
  }
  if (typeof file.base64 === "string" && file.base64.trim()) {
    return {
      kind: "data_url",
      url: `data:${file.mime_type || "application/octet-stream"};base64,${file.base64.trim()}`,
    };
  }
  if (typeof file.url === "string" && /^https?:\/\//i.test(file.url)) {
    return { kind: "direct_url", url: file.url };
  }
  if (file.message_id) {
    return { kind: "message_lookup" };
  }
  if (typeof file.url === "string" && file.url.startsWith("/api/")) {
    return { kind: "direct_url", url: file.url };
  }
  return { kind: "none" };
}
