import { describe, expect, it } from "vitest";
import {
  isFeishuGroupAllowed,
  resolveFeishuAllowlistMatch,
  resolveFeishuGroupCommandMentionBypass,
  resolveFeishuGroupConfig,
  resolveFeishuGroupToolPolicy,
  resolveFeishuReplyPolicy,
} from "../policy.js";

describe("policy", () => {
  it("matches allowlist by wildcard, sender id, and sender name", () => {
    expect(
      resolveFeishuAllowlistMatch({ allowFrom: ["*"], senderId: "ou_1", senderName: "Alice" }),
    ).toEqual({ allowed: true, matchKey: "*", matchSource: "wildcard" });

    expect(
      resolveFeishuAllowlistMatch({
        allowFrom: ["ou_1"],
        senderId: "OU_1",
        senderName: "Alice",
      }),
    ).toEqual({ allowed: true, matchKey: "ou_1", matchSource: "id" });

    expect(
      resolveFeishuAllowlistMatch({
        allowFrom: ["alice"],
        senderId: "ou_2",
        senderName: "Alice",
      }),
    ).toEqual({ allowed: true, matchKey: "alice", matchSource: "name" });
  });

  it("resolves group config case-insensitively", () => {
    const cfg = {
      groups: {
        OC_ABC: {
          requireMention: false,
        },
      },
    } as any;

    expect(resolveFeishuGroupConfig({ cfg, groupId: "oc_abc" })).toEqual({
      requireMention: false,
    });
    expect(resolveFeishuGroupConfig({ cfg, groupId: "unknown" })).toBeUndefined();
  });

  it("returns group tool policy from channel config", () => {
    const policy = resolveFeishuGroupToolPolicy({
      cfg: {
        channels: {
          clawdbot_feishu: {
            groups: {
              oc_123: {
                tools: { allow: ["feishu_doc"] },
              },
            },
          },
        },
      } as any,
      groupId: "oc_123",
    } as any);

    expect(policy).toEqual({ allow: ["feishu_doc"] });
  });

  it("checks group policy correctly", () => {
    expect(
      isFeishuGroupAllowed({
        groupPolicy: "disabled",
        allowFrom: ["*"],
        senderId: "ou_1",
      }),
    ).toBe(false);
    expect(
      isFeishuGroupAllowed({
        groupPolicy: "open",
        allowFrom: [],
        senderId: "ou_1",
      }),
    ).toBe(true);
    expect(
      isFeishuGroupAllowed({
        groupPolicy: "allowlist",
        allowFrom: ["ou_1"],
        senderId: "ou_1",
      }),
    ).toBe(true);
  });

  it("resolves reply policy and command mention bypass with defaults", () => {
    expect(
      resolveFeishuReplyPolicy({
        isDirectMessage: true,
      }),
    ).toEqual({ requireMention: false, allowMentionlessInMultiBotGroup: false });

    expect(
      resolveFeishuReplyPolicy({
        isDirectMessage: false,
        globalConfig: { requireMention: false, allowMentionlessInMultiBotGroup: true } as any,
      }),
    ).toEqual({ requireMention: false, allowMentionlessInMultiBotGroup: true });

    expect(
      resolveFeishuGroupCommandMentionBypass({
        globalConfig: { groupCommandMentionBypass: "always" } as any,
        groupConfig: { groupCommandMentionBypass: "never" } as any,
      }),
    ).toBe("never");

    expect(resolveFeishuGroupCommandMentionBypass({})).toBe("single_bot");
  });
});
