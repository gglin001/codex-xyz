import { describe, expect, it } from "vitest";
import {
  DEFAULT_CODEX_XYZ_API_URL,
  DEFAULT_CODEX_XYZ_UI_URL,
  readApiUrl,
  readUiUrl
} from "../src/config.js";

describe("URL environment config", () => {
  it("uses default UI and API URLs", () => {
    expect(readUiUrl({}).origin).toBe(DEFAULT_CODEX_XYZ_UI_URL);
    expect(readApiUrl({}).origin).toBe(DEFAULT_CODEX_XYZ_API_URL);
  });

  it("reads UI and API URLs from env", () => {
    const env = {
      CODEX_XYZ_UI_URL: "http://0.0.0.0:1123",
      CODEX_XYZ_API_URL: "http://127.0.0.1:3211"
    };

    expect(readUiUrl(env)).toMatchObject({
      origin: "http://0.0.0.0:1123",
      hostname: "0.0.0.0",
      port: 1123
    });
    expect(readApiUrl(env)).toMatchObject({
      origin: "http://127.0.0.1:3211",
      hostname: "127.0.0.1",
      port: 3211
    });
  });

  it("keeps PORT as an API port fallback", () => {
    expect(readApiUrl({ PORT: "9000" })).toMatchObject({
      origin: "http://127.0.0.1:9000",
      hostname: "127.0.0.1",
      port: 9000
    });
  });

  it("rejects invalid URL config", () => {
    expect(() => readApiUrl({ CODEX_XYZ_API_URL: "file:///tmp/api" })).toThrow(/http or https/);
    expect(() => readUiUrl({ CODEX_XYZ_UI_URL: "not-a-url" })).toThrow(/valid URL/);
    expect(() => readApiUrl({ PORT: "abc" })).toThrow(/TCP port/);
  });
});
