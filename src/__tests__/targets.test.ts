import { describe, expect, it } from "vitest";
import {
  detectIdType,
  formatFeishuTarget,
  looksLikeFeishuId,
  normalizeFeishuTarget,
  resolveReceiveIdType,
} from "../targets.js";

describe("targets", () => {
  it("detects id types", () => {
    expect(detectIdType("oc_123")).toBe("chat_id");
    expect(detectIdType("ou_123")).toBe("open_id");
    expect(detectIdType("user_123")).toBe("user_id");
    expect(detectIdType("")).toBeNull();
  });

  it("normalizes prefixed targets", () => {
    expect(normalizeFeishuTarget("chat:oc_123")).toBe("oc_123");
    expect(normalizeFeishuTarget("user:ou_123")).toBe("ou_123");
    expect(normalizeFeishuTarget("open_id:ou_123")).toBe("ou_123");
    expect(normalizeFeishuTarget("   ")).toBeNull();
  });

  it("formats and resolves receive id types", () => {
    expect(formatFeishuTarget("oc_123")).toBe("chat:oc_123");
    expect(formatFeishuTarget("ou_123")).toBe("user:ou_123");
    expect(formatFeishuTarget("user_123")).toBe("user_123");
    expect(resolveReceiveIdType("oc_123")).toBe("chat_id");
    expect(resolveReceiveIdType("ou_123")).toBe("open_id");
    expect(resolveReceiveIdType("user_123")).toBe("user_id");
  });

  it("detects feishu target-like values", () => {
    expect(looksLikeFeishuId("chat:oc_123")).toBe(true);
    expect(looksLikeFeishuId("user:ou_123")).toBe(true);
    expect(looksLikeFeishuId("oc_123")).toBe(true);
    expect(looksLikeFeishuId("ou_123")).toBe(true);
    expect(looksLikeFeishuId("not-an-id")).toBe(false);
  });
});
