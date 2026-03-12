import { describe, expect, it } from "vitest";
import { FeishuAccountConfigSchema, FeishuConfigSchema } from "../config-schema.js";

describe("config-schema", () => {
  it("applies defaults to minimal config", () => {
    const parsed = FeishuConfigSchema.parse({});
    expect(parsed.domain).toBe("feishu");
    expect(parsed.connectionMode).toBe("websocket");
    expect(parsed.dmPolicy).toBe("pairing");
    expect(parsed.groupPolicy).toBe("allowlist");
    expect(parsed.requireMention).toBe(true);
  });

  it("rejects dmPolicy=open without wildcard allowFrom", () => {
    const result = FeishuConfigSchema.safeParse({
      dmPolicy: "open",
      allowFrom: ["ou_123"],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["allowFrom"]);
  });

  it("accepts dmPolicy=open with wildcard allowFrom", () => {
    const result = FeishuConfigSchema.safeParse({
      dmPolicy: "open",
      allowFrom: ["*"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts custom https domains and voice tool config", () => {
    const parsed = FeishuConfigSchema.parse({
      domain: "https://open.example.com",
      tools: {
        voice: false,
      },
    });

    expect(parsed.domain).toBe("https://open.example.com");
    expect(parsed.tools?.voice).toBe(false);
  });

  it("accepts custom domains in account config and rejects http domains", () => {
    expect(
      FeishuAccountConfigSchema.parse({
        domain: "https://open.example.com",
      }).domain,
    ).toBe("https://open.example.com");

    expect(
      FeishuAccountConfigSchema.safeParse({
        domain: "http://open.example.com",
      }).success,
    ).toBe(false);
  });
});
