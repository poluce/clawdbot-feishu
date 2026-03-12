import { describe, expect, it } from "vitest";
import {
  buildMentionedCardContent,
  buildMentionedMessage,
  extractMentionTargets,
  extractMessageBody,
  formatMentionAllForCard,
  formatMentionAllForText,
  formatMentionForCard,
  formatMentionForText,
  isMentionForwardRequest,
} from "../mention.js";

const buildEvent = (chatType: "group" | "p2p" = "group") =>
  ({
    message: {
      chat_type: chatType,
      mentions: [
        {
          key: "@_user_1",
          id: { open_id: "ou_bot" },
          name: "Bot",
        },
        {
          key: "@_user_2",
          id: { open_id: "ou_alice" },
          name: "Alice",
        },
        {
          key: "@_user_3",
          id: {},
          name: "NoOpenId",
        },
      ],
    },
  }) as any;

describe("mention", () => {
  it("extracts mention targets excluding the bot and missing open_id entries", () => {
    expect(extractMentionTargets(buildEvent(), "ou_bot")).toEqual([
      {
        openId: "ou_alice",
        name: "Alice",
        key: "@_user_2",
      },
    ]);
  });

  it("detects mention forwarding rules for groups and direct messages", () => {
    expect(isMentionForwardRequest(buildEvent("group"), "ou_bot")).toBe(true);
    expect(isMentionForwardRequest(buildEvent("p2p"), "ou_bot")).toBe(true);
    expect(
      isMentionForwardRequest(
        {
          message: {
            chat_type: "group",
            mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" }, name: "Bot" }],
          },
        } as any,
        "ou_bot",
      ),
    ).toBe(false);
  });

  it("removes mention placeholders from message body", () => {
    expect(extractMessageBody("hello @_user_1  @_user_2 world", ["@_user_1", "@_user_2"])).toBe(
      "hello world",
    );
  });

  it("formats mentions for text and card messages", () => {
    const target = { openId: "ou_alice", name: "Alice", key: "@_user_2" };
    expect(formatMentionForText(target)).toBe('<at user_id="ou_alice">Alice</at>');
    expect(formatMentionForCard(target)).toBe("<at id=ou_alice></at>");
    expect(formatMentionAllForText()).toBe('<at user_id="all">Everyone</at>');
    expect(formatMentionAllForCard()).toBe("<at id=all></at>");
  });

  it("builds complete mentioned content", () => {
    const targets = [{ openId: "ou_alice", name: "Alice", key: "@_user_2" }];
    expect(buildMentionedMessage(targets, "hello")).toBe('<at user_id="ou_alice">Alice</at> hello');
    expect(buildMentionedCardContent(targets, "hello")).toBe("<at id=ou_alice></at> hello");
  });
});
