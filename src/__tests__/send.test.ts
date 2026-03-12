import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  resolveFeishuAccount: vi.fn(),
  listFeishuAccountIds: vi.fn(() => []),
  createFeishuClient: vi.fn(),
  normalizeFeishuMarkdownLinks: vi.fn((text: string) => text),
  normalizeFeishuTarget: vi.fn((target: string) => target),
  resolveReceiveIdType: vi.fn(() => "chat_id"),
  getFeishuRuntime: vi.fn(),
}));

vi.mock("../accounts.js", () => ({
  resolveFeishuAccount: mocked.resolveFeishuAccount,
  listFeishuAccountIds: mocked.listFeishuAccountIds,
}));

vi.mock("../client.js", () => ({
  createFeishuClient: mocked.createFeishuClient,
}));

vi.mock("../text/markdown-links.js", () => ({
  normalizeFeishuMarkdownLinks: mocked.normalizeFeishuMarkdownLinks,
}));

vi.mock("../targets.js", () => ({
  normalizeFeishuTarget: mocked.normalizeFeishuTarget,
  resolveReceiveIdType: mocked.resolveReceiveIdType,
}));

vi.mock("../runtime.js", () => ({
  getFeishuRuntime: mocked.getFeishuRuntime,
}));

import {
  buildMarkdownCard,
  editMessageFeishu,
  getMessageFeishu,
  sendCardFeishu,
  sendMarkdownCardFeishu,
  sendMessageFeishu,
  updateCardFeishu,
} from "../send.js";

function setupSendModule() {
  const client = {
    im: {
      message: {
        create: vi.fn().mockResolvedValue({ code: 0, data: { message_id: "om_created" } }),
        reply: vi.fn().mockResolvedValue({ code: 0, data: { message_id: "om_reply" } }),
        patch: vi.fn().mockResolvedValue({ code: 0 }),
        update: vi.fn().mockResolvedValue({ code: 0 }),
        get: vi.fn(),
      },
    },
  };

  mocked.resolveFeishuAccount.mockReturnValue({
    accountId: "acc",
    configured: true,
  });
  mocked.createFeishuClient.mockReturnValue(client);
  mocked.getFeishuRuntime.mockReturnValue({
    channel: {
      text: {
        resolveMarkdownTableMode: vi.fn(() => "ascii"),
        convertMarkdownTables: vi.fn((text: string) => `converted:${text}`),
      },
    },
  });

  return { client };
}

describe("send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds schema 2.0 markdown cards", () => {
    expect(buildMarkdownCard("hello")).toEqual({
      schema: "2.0",
      config: {
        wide_screen_mode: true,
      },
      body: {
        elements: [
          {
            tag: "markdown",
            content: "hello",
          },
        ],
      },
    });
  });

  it("sends post messages for normal text", async () => {
    const { client } = setupSendModule();

    const result = await sendMessageFeishu({
      cfg: {} as any,
      to: "oc_123",
      text: "hello",
    });

    expect(client.im.message.create).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_123",
        content: JSON.stringify({
          zh_cn: {
            content: [[{ tag: "md", text: "converted:hello" }]],
          },
        }),
        msg_type: "post",
      },
    });
    expect(result).toEqual({ messageId: "om_created", chatId: "oc_123" });
  });

  it("replies instead of creating when replyToMessageId is provided", async () => {
    const { client } = setupSendModule();

    const result = await sendCardFeishu({
      cfg: {} as any,
      to: "oc_123",
      card: { hello: "world" },
      replyToMessageId: "om_parent",
    });

    expect(client.im.message.reply).toHaveBeenCalledWith({
      path: { message_id: "om_parent" },
      data: {
        content: JSON.stringify({ hello: "world" }),
        msg_type: "interactive",
      },
    });
    expect(result).toEqual({ messageId: "om_reply", chatId: "oc_123" });
  });

  it("sends markdown cards with mention content", async () => {
    const { client } = setupSendModule();

    await sendMarkdownCardFeishu({
      cfg: {} as any,
      to: "oc_123",
      text: "hello",
      mentions: [{ openId: "ou_1", name: "Alice", key: "@_user_1" }],
    });

    expect(client.im.message.create).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_123",
        content: JSON.stringify({
          schema: "2.0",
          config: { wide_screen_mode: true },
          body: {
            elements: [{ tag: "markdown", content: "<at id=ou_1></at> hello" }],
          },
        }),
        msg_type: "interactive",
      },
    });
  });

  it("rejects invalid targets", async () => {
    mocked.resolveFeishuAccount.mockReturnValue({ accountId: "acc", configured: true });
    mocked.createFeishuClient.mockReturnValue({
      im: { message: { create: vi.fn(), reply: vi.fn(), patch: vi.fn(), update: vi.fn() } },
    });
    mocked.normalizeFeishuTarget.mockReturnValueOnce(null);

    await expect(
      sendMessageFeishu({
        cfg: {} as any,
        to: "bad-target",
        text: "hello",
      }),
    ).rejects.toThrow("Invalid Feishu target: bad-target");
  });

  it("updates cards via message.patch", async () => {
    const { client } = setupSendModule();

    await updateCardFeishu({
      cfg: {} as any,
      messageId: "om_card",
      card: { hello: "world" },
    });

    expect(client.im.message.patch).toHaveBeenCalledWith({
      path: { message_id: "om_card" },
      data: {
        content: JSON.stringify({ hello: "world" }),
      },
    });
  });

  it("edits text messages through message.update", async () => {
    const { client } = setupSendModule();

    await editMessageFeishu({
      cfg: {} as any,
      messageId: "om_edit",
      text: "hello",
    });

    expect(client.im.message.update).toHaveBeenCalledWith({
      path: { message_id: "om_edit" },
      data: {
        msg_type: "post",
        content: JSON.stringify({
          zh_cn: {
            content: [[{ tag: "md", text: "converted:hello" }]],
          },
        }),
      },
    });
  });

  it("returns parsed message info for normal messages", async () => {
    const { client } = setupSendModule();
    client.im.message.get.mockResolvedValue({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_1",
            chat_id: "oc_123",
            msg_type: "text",
            body: { content: JSON.stringify({ text: "hello" }) },
            sender: { id: "ou_sender", id_type: "open_id" },
            create_time: "123456",
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as any,
      messageId: "om_1",
    });

    expect(result).toEqual({
      messageId: "om_1",
      chatId: "oc_123",
      senderId: "ou_sender",
      senderOpenId: "ou_sender",
      content: "hello",
      contentType: "text",
      createTime: 123456,
    });
  });

  it("returns merged-forward content with child sender labels", async () => {
    const { client } = setupSendModule();
    client.im.message.get.mockResolvedValue({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_merge",
            chat_id: "oc_123",
            msg_type: "merge_forward",
          },
          {
            body: { content: JSON.stringify({ sender_name: "Alice", text: "First" }) },
            sender: { id: "ou_alice", id_type: "open_id" },
            msg_type: "text",
          },
          {
            body: { content: JSON.stringify({ sender_name: "Bob", text: "Second" }) },
            sender: { id: "ou_bob", id_type: "open_id" },
            msg_type: "text",
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as any,
      messageId: "om_merge",
    });

    expect(result?.content).toBe("[Alice] First\n\n---\n\n[Bob] Second");
    expect(result?.contentType).toBe("merge_forward");
  });

  it("returns null when message lookup fails or has no items", async () => {
    const { client } = setupSendModule();
    client.im.message.get.mockResolvedValueOnce({ code: 999 });
    await expect(getMessageFeishu({ cfg: {} as any, messageId: "om_missing" })).resolves.toBeNull();

    client.im.message.get.mockResolvedValueOnce({ code: 0, data: { items: [] } });
    await expect(getMessageFeishu({ cfg: {} as any, messageId: "om_empty" })).resolves.toBeNull();

    client.im.message.get.mockRejectedValueOnce(new Error("boom"));
    await expect(getMessageFeishu({ cfg: {} as any, messageId: "om_error" })).resolves.toBeNull();
  });
});
