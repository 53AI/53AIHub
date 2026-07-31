import { describe, expect, it } from "vitest";
import { decodeOutputFile, decodeOutputFiles } from "./openclaw-transport";

describe("decodeOutputFile — transport shape normalization", () => {
  describe("snake_case wire format", () => {
    it("decodes all standard fields from snake_case keys", () => {
      const decoded = decodeOutputFile({
        id: "abc",
        file_id: "fid",
        file_name: "report.pdf",
        mime_type: "application/pdf",
        size: 1024,
        preview_url: "https://cdn/preview.png",
        download_url: "https://cdn/download",
        signed_download_url: "https://cdn/signed",
        artifact_id: "art",
        upload_file_id: "uf",
        message_id: 42,
        source_kind: "upload",
        kind: "document",
        preview_key: "key-1",
        file_path: "/tmp/report.pdf",
        is_favorite: true,
      });
      expect(decoded).toEqual({
        id: "abc",
        name: "report.pdf",
        file_name: "report.pdf",
        url: undefined,
        preview_url: "https://cdn/preview.png",
        preview_key: "key-1",
        download_url: "https://cdn/download",
        signed_download_url: "https://cdn/signed",
        artifact_id: "art",
        upload_file_id: "uf",
        mime_type: "application/pdf",
        size: 1024,
        kind: "document",
        message_id: 42,
        source_kind: "upload",
        base64: undefined,
        content: undefined,
        file_path: "/tmp/report.pdf",
        is_favorite: true,
      });
    });

    it("falls back to file_id when id is missing", () => {
      const decoded = decodeOutputFile({ file_id: "f1", file_name: "a.txt" });
      expect(decoded?.id).toBe("f1");
    });

    it("falls back to artifact_id, upload_file_id, then url", () => {
      expect(decodeOutputFile({ artifact_id: "a1" })?.id).toBe("a1");
      expect(decodeOutputFile({ upload_file_id: "u1" })?.id).toBe("u1");
      expect(decodeOutputFile({ url: "https://cdn/raw" })?.id).toBe("https://cdn/raw");
    });

    it("parses string-encoded size", () => {
      const decoded = decodeOutputFile({ id: "1", size: "2048" });
      expect(decoded?.size).toBe(2048);
    });
  });

  describe("camelCase wire format", () => {
    it("decodes all standard fields from camelCase keys", () => {
      const decoded = decodeOutputFile({
        id: "1",
        fileId: "fid",
        fileName: "data.csv",
        mimeType: "text/csv",
        fileSize: 512,
        previewUrl: "https://cdn/preview",
        downloadUrl: "https://cdn/dl",
        signedDownloadUrl: "https://cdn/sd",
        artifactId: "art",
        uploadFileId: "uf",
        messageId: "m1",
        sourceKind: "import",
        previewKey: "k",
        filePath: "/data/data.csv",
        isFavorite: false,
      });
      expect(decoded).toEqual({
        id: "1",
        name: "data.csv",
        file_name: "data.csv",
        url: undefined,
        preview_url: "https://cdn/preview",
        preview_key: "k",
        download_url: "https://cdn/dl",
        signed_download_url: "https://cdn/sd",
        artifact_id: "art",
        upload_file_id: "uf",
        mime_type: "text/csv",
        size: 512,
        kind: undefined,
        message_id: "m1",
        source_kind: "import",
        base64: undefined,
        content: undefined,
        file_path: "/data/data.csv",
        is_favorite: false,
      });
    });

    it("accepts filename as alias for name/file_name/fileName", () => {
      const decoded = decodeOutputFile({ id: "1", filename: "x.png" });
      expect(decoded?.name).toBe("x.png");
      expect(decoded?.file_name).toBe("x.png");
    });
  });

  describe("mixed and degenerate inputs", () => {
    it("prefers snake_case when both snake and camel are present (snake first)", () => {
      const decoded = decodeOutputFile({
        file_id: "snake",
        fileId: "camel",
        file_name: "snake-name",
        fileName: "camel-name",
      });
      expect(decoded?.id).toBe("snake");
      expect(decoded?.file_name).toBe("snake-name");
    });

    it("exposes data: urls through url when preview_url is missing", () => {
      const dataUrl = "data:image/png;base64,AAAA";
      const decoded = decodeOutputFile({ id: "1", url: dataUrl });
      expect(decoded?.url).toBe(dataUrl);
      expect(decoded?.preview_url).toBeUndefined();
    });

    it("keeps non-data urls off the preview_url field", () => {
      const decoded = decodeOutputFile({ id: "1", url: "https://cdn/raw.png" });
      expect(decoded?.url).toBe("https://cdn/raw.png");
      expect(decoded?.preview_url).toBeUndefined();
    });

    it("returns null for null / undefined / non-object inputs", () => {
      expect(decodeOutputFile(null)).toBeNull();
      expect(decodeOutputFile(undefined)).toBeNull();
      expect(decodeOutputFile("hello")).toBeNull();
      expect(decodeOutputFile(42)).toBeNull();
      expect(decodeOutputFile(true)).toBeNull();
    });

    it("returns null when no id can be derived", () => {
      expect(decodeOutputFile({})).toBeNull();
      expect(decodeOutputFile({ name: "no-id" })).toBeNull();
      expect(decodeOutputFile({ file_name: "no-id" })).toBeNull();
    });

    it("preserves base64 and content verbatim", () => {
      const decoded = decodeOutputFile({
        id: "1",
        base64: "QUJD",
        content: "raw text",
      });
      expect(decoded?.base64).toBe("QUJD");
      expect(decoded?.content).toBe("raw text");
    });
  });
});

describe("decodeOutputFiles — array decoding", () => {
  it("returns [] for non-array input", () => {
    expect(decodeOutputFiles(null)).toEqual([]);
    expect(decodeOutputFiles(undefined)).toEqual([]);
    expect(decodeOutputFiles({})).toEqual([]);
    expect(decodeOutputFiles("string")).toEqual([]);
  });

  it("returns [] for empty array", () => {
    expect(decodeOutputFiles([])).toEqual([]);
  });

  it("skips invalid items but keeps valid ones", () => {
    const result = decodeOutputFiles([
      null,
      undefined,
      "string",
      {},
      { id: "valid" },
      { file_id: "also-valid" },
    ]);
    expect(result.map((f) => f.id)).toEqual(["valid", "also-valid"]);
  });

  it("decodes heterogeneous snake_case + camelCase items", () => {
    const result = decodeOutputFiles([
      { id: "1", file_name: "a.txt", size: 100 },
      { id: 2, fileName: "b.txt", fileSize: "200" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "1", file_name: "a.txt", size: 100 });
    expect(result[1]).toMatchObject({ id: 2, file_name: "b.txt", size: 200 });
  });
});
