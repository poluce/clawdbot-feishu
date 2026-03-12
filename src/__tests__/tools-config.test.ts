import { describe, expect, it } from "vitest";
import { DEFAULT_TOOLS_CONFIG, resolveToolsConfig } from "../tools-config.js";

describe("tools-config", () => {
  it("defines the expected defaults", () => {
    expect(DEFAULT_TOOLS_CONFIG).toEqual({
      doc: true,
      wiki: true,
      drive: true,
      perm: false,
      scopes: true,
      task: true,
      chat: true,
      urgent: true,
      voice: true,
    });
  });

  it("merges partial config with defaults", () => {
    expect(resolveToolsConfig({ perm: true, voice: false })).toEqual({
      doc: true,
      wiki: true,
      drive: true,
      perm: true,
      scopes: true,
      task: true,
      chat: true,
      urgent: true,
      voice: false,
    });
  });
});
