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
  const contactUserGet = vi.fn();
  const request = vi.fn();
  const client: {
    request: ReturnType<typeof vi.fn>;
    contact?: {
      user: {
        get: ReturnType<typeof vi.fn>;
      };
    };
    im: {
      message: {
        create: ReturnType<typeof vi.fn>;
        reply: ReturnType<typeof vi.fn>;
        patch: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
        get: ReturnType<typeof vi.fn>;
      };
    };
  } = {
    request,
    contact: {
      user: {
        get: contactUserGet,
      },
    },
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

  it("throws when account is not configured for send variants", async () => {
    mocked.resolveFeishuAccount.mockReturnValue({ accountId: "acc", configured: false });

    await expect(
      sendMessageFeishu({
        cfg: {} as any,
        to: "oc_123",
        text: "hello",
      }),
    ).rejects.toThrow('Feishu account "acc" not configured');

    await expect(
      sendCardFeishu({
        cfg: {} as any,
        to: "oc_123",
        card: {},
      }),
    ).rejects.toThrow('Feishu account "acc" not configured');

    await expect(
      updateCardFeishu({
        cfg: {} as any,
        messageId: "om_card",
        card: {},
      }),
    ).rejects.toThrow('Feishu account "acc" not configured');

    await expect(
      editMessageFeishu({
        cfg: {} as any,
        messageId: "om_edit",
        text: "hello",
      }),
    ).rejects.toThrow('Feishu account "acc" not configured');

    await expect(getMessageFeishu({ cfg: {} as any, messageId: "om_1" })).rejects.toThrow(
      'Feishu account "acc" not configured',
    );
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

  it("injects mentions into post text messages", async () => {
    const { client } = setupSendModule();

    await sendMessageFeishu({
      cfg: {} as any,
      to: "oc_123",
      text: "hello",
      mentions: [{ openId: "ou_1", name: "Alice", key: "@_user_1" }],
    });

    expect(client.im.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: JSON.stringify({
            zh_cn: {
              content: [[{ tag: "md", text: 'converted:<at user_id="ou_1">Alice</at> hello' }]],
            },
          }),
        }),
      }),
    );
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

  it("throws for send and reply failures", async () => {
    const { client } = setupSendModule();
    client.im.message.reply.mockResolvedValueOnce({ code: 999, msg: "reply failed" });
    await expect(
      sendMessageFeishu({
        cfg: {} as any,
        to: "oc_123",
        text: "hello",
        replyToMessageId: "om_parent",
      }),
    ).rejects.toThrow("Feishu reply failed: reply failed");

    client.im.message.create.mockResolvedValueOnce({ code: 999, msg: "card send failed" });
    await expect(
      sendCardFeishu({
        cfg: {} as any,
        to: "oc_123",
        card: { hello: "world" },
      }),
    ).rejects.toThrow("Feishu card send failed: card send failed");

    client.im.message.reply.mockResolvedValueOnce({ code: 999, msg: "card reply failed" });
    await expect(
      sendCardFeishu({
        cfg: {} as any,
        to: "oc_123",
        card: { hello: "world" },
        replyToMessageId: "om_parent",
      }),
    ).rejects.toThrow("Feishu card reply failed: card reply failed");

    client.im.message.create.mockResolvedValueOnce({ code: 999, msg: "send failed" });
    await expect(
      sendMessageFeishu({
        cfg: {} as any,
        to: "oc_123",
        text: "hello",
      }),
    ).rejects.toThrow("Feishu send failed: send failed");
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

    mocked.normalizeFeishuTarget.mockReturnValueOnce(null);
    await expect(
      sendCardFeishu({
        cfg: {} as any,
        to: "bad-card-target",
        card: {},
      }),
    ).rejects.toThrow("Invalid Feishu target: bad-card-target");
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

  it("throws when card patch fails", async () => {
    const { client } = setupSendModule();
    client.im.message.patch.mockResolvedValueOnce({ code: 999, msg: "patch failed" });

    await expect(
      updateCardFeishu({
        cfg: {} as any,
        messageId: "om_card",
        card: { hello: "world" },
      }),
    ).rejects.toThrow("Feishu card update failed: patch failed");
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

  it("throws when message edit fails", async () => {
    const { client } = setupSendModule();
    client.im.message.update.mockResolvedValueOnce({ code: 999, msg: "edit failed" });

    await expect(
      editMessageFeishu({
        cfg: {} as any,
        messageId: "om_edit",
        text: "hello",
      }),
    ).rejects.toThrow("Feishu message edit failed: edit failed");
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

  it("returns null when account is not configured for message lookup", async () => {
    mocked.resolveFeishuAccount.mockReturnValue({ accountId: "acc", configured: false });
    await expect(getMessageFeishu({ cfg: {} as any, messageId: "om_1" })).rejects.toThrow(
      'Feishu account "acc" not configured',
    );
  });

  it("extracts card and fallback content shapes from message lookup", async () => {
    const { client } = setupSendModule();
    client.im.message.get.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_card",
            chat_id: "oc_123",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({
                title: "Card Title",
                elements: [[{ tag: "text", text: "Body text" }]],
              }),
            },
          },
        ],
      },
    });
    const cardResult = await getMessageFeishu({ cfg: {} as any, messageId: "om_card" });
    expect(cardResult?.content).toBe("Card Title");

    client.im.message.get.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_card_body",
            chat_id: "oc_123",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({
                elements: [[{ tag: "text", text: "Body text" }]],
              }),
            },
          },
        ],
      },
    });
    const bodyOnlyResult = await getMessageFeishu({ cfg: {} as any, messageId: "om_card_body" });
    expect(bodyOnlyResult?.content).toBe("Body text");

    client.im.message.get.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_placeholder",
            chat_id: "oc_123",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({
                elements: [[{ tag: "text", text: "请升级至最新版本客户端查看" }]],
              }),
            },
          },
        ],
      },
    });
    const placeholderResult = await getMessageFeishu({ cfg: {} as any, messageId: "om_placeholder" });
    expect(placeholderResult?.content).toBe("[Card message]");

    client.im.message.get.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_rich",
            chat_id: "oc_123",
            msg_type: "post",
            body: {
              content: JSON.stringify({
                content: [[
                  { tag: "text", text: "Hello " },
                  { tag: "a", href: "https://example.com" },
                  { tag: "img" },
                  { tag: "at" },
                ]],
              }),
            },
          },
        ],
      },
    });
    const richResult = await getMessageFeishu({ cfg: {} as any, messageId: "om_rich" });
    expect(richResult?.content).toContain("Hello");
    expect(richResult?.content).toContain("https://example.com");
    expect(richResult?.content).toContain("[Image]");
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

  it("resolves configured app labels in merged-forward content", async () => {
    const { client } = setupSendModule();
    mocked.listFeishuAccountIds.mockReturnValue(["known"]);
    mocked.resolveFeishuAccount.mockImplementation(({ accountId }: any) => {
      if (accountId === "known") {
        return {
          accountId: "known",
          configured: true,
          appId: "cli_known",
          name: "Known App",
        };
      }
      return {
        accountId: "acc",
        configured: true,
      };
    });

    client.im.message.get.mockResolvedValue({
      code: 0,
      data: {
        items: [
          { message_id: "om_merge", chat_id: "oc_123", msg_type: "merge_forward" },
          {
            body: { content: JSON.stringify({ text: "hello app_id:cli_known" }) },
            sender: { id: "cli_known", id_type: "app_id", sender_type: "app" },
            msg_type: "text",
          },
        ],
      },
    });

    const result = await getMessageFeishu({ cfg: {} as any, messageId: "om_merge" });
    expect(result?.content).toBe("[Known App] hello Known App");
  });

  it("uses bot info lookup when app sender matches a configured account", async () => {
    const { client } = setupSendModule();
    const botClient = {
      ...client,
      request: vi.fn().mockResolvedValue({
        data: {
          bot: {
            app_name: "Resolved Bot Name",
          },
        },
      }),
    };

    mocked.listFeishuAccountIds.mockReturnValue(["known"]);
    mocked.resolveFeishuAccount.mockImplementation(({ accountId }: any) => {
      if (accountId === "known") {
        return {
          accountId: "known",
          configured: true,
          appId: "cli_known",
          name: "Known Account",
        };
      }
      return {
        accountId: "acc",
        configured: true,
      };
    });
    mocked.createFeishuClient.mockImplementation((account: any) =>
      account.accountId === "known" ? botClient : client,
    );

    client.im.message.get.mockResolvedValue({
      code: 0,
      data: {
        items: [
          { message_id: "om_merge", chat_id: "oc_123", msg_type: "merge_forward" },
          {
            body: { content: JSON.stringify({ text: "hello" }) },
            sender: { id: "cli_known", id_type: "app_id", sender_type: "app" },
            msg_type: "text",
          },
        ],
      },
    });

    const result = await getMessageFeishu({ cfg: {} as any, messageId: "om_merge" });
    expect(result?.content).toBe("[Known Account] hello");
  });

  it("falls back to bot info lookup when configured account has no display name", async () => {
    const { client } = setupSendModule();
    const botClient = {
      ...client,
      request: vi.fn().mockResolvedValue({
        data: {
          bot: {
            app_name: "Resolved Bot Name",
          },
        },
      }),
    };

    mocked.listFeishuAccountIds.mockReturnValue(["known"]);
    mocked.resolveFeishuAccount.mockImplementation(({ accountId }: any) => {
      if (accountId === "known") {
        return {
          accountId: "known",
          configured: true,
          appId: "cli_known",
          name: "",
        };
      }
      return {
        accountId: "acc",
        configured: true,
      };
    });
    mocked.createFeishuClient.mockImplementation((account: any) =>
      account.accountId === "known" ? botClient : client,
    );

    client.im.message.get.mockResolvedValue({
      code: 0,
      data: {
        items: [
          { message_id: "om_merge", chat_id: "oc_123", msg_type: "merge_forward" },
          {
            body: { content: JSON.stringify({ text: "hello" }) },
            sender: { id: "cli_known", id_type: "app_id", sender_type: "app" },
            msg_type: "text",
          },
        ],
      },
    });

    const result = await getMessageFeishu({ cfg: {} as any, messageId: "om_merge" });
    expect(result?.content).toBe("[Resolved Bot Name] hello");
  });

  it("falls back for app sender labels when account client creation or API lookup fails", async () => {
    const { client } = setupSendModule();
    mocked.listFeishuAccountIds.mockReturnValue(["known"]);
    mocked.resolveFeishuAccount.mockImplementation(({ accountId }: any) => {
      if (accountId === "known") {
        return {
          accountId: "known",
          configured: true,
          appId: "cli_known",
          name: "",
        };
      }
      return {
        accountId: "acc",
        configured: true,
      };
    });
    mocked.createFeishuClient.mockImplementation((account: any) => {
      if (account.accountId === "known") {
        throw new Error("create client failed");
      }
      return client;
    });
    client.im.message.get.mockResolvedValue({
      code: 0,
      data: {
        items: [
          { message_id: "om_merge", chat_id: "oc_123", msg_type: "merge_forward" },
          {
            body: { content: JSON.stringify({ text: "hello" }) },
            sender: { id: "cli_known", id_type: "app_id", sender_type: "app" },
            msg_type: "text",
          },
        ],
      },
    });

    const result = await getMessageFeishu({ cfg: {} as any, messageId: "om_merge" });
    expect(result?.content).toBe("[known] hello");
  });

  it("falls back for unconfigured app senders without request support", async () => {
    const { client } = setupSendModule();
    mocked.listFeishuAccountIds.mockReturnValue([]);
    client.request = undefined as any;
    client.im.message.get.mockResolvedValue({
      code: 0,
      data: {
        items: [
          { message_id: "om_merge", chat_id: "oc_123", msg_type: "merge_forward" },
          {
            body: { content: JSON.stringify({ text: "hello" }) },
            sender: { id: "cli_unknown", id_type: "app_id", sender_type: "app" },
            msg_type: "text",
          },
        ],
      },
    });

    const result = await getMessageFeishu({ cfg: {} as any, messageId: "om_merge" });
    expect(result?.content).toBe("[app_id:cli_unknown] hello");
  });

  it("replaces known and unresolved mention placeholders", async () => {
    const { client } = setupSendModule();
    client.im.message.get.mockResolvedValue({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_mention",
            chat_id: "oc_123",
            msg_type: "text",
            body: { content: JSON.stringify({ text: "@_user_1 and @_user_2" }) },
            mentions: [
              {
                key: "@_user_1",
                id: "ou_1",
                id_type: "open_id",
                name: "Alice",
              },
            ],
          },
        ],
      },
    });

    const result = await getMessageFeishu({ cfg: {} as any, messageId: "om_mention" });
    expect(result?.content).toBe("@Alice and @mentioned");
  });

  it("resolves human sender labels through contact lookup and cache", async () => {
    const { client } = setupSendModule();
    client.contact = {
      user: {
        get: vi.fn().mockResolvedValue({
          data: {
            user: {
              name: "Alice Human",
            },
          },
        }),
      },
    };
    client.im.message.get.mockResolvedValue({
      code: 0,
      data: {
        items: [
          { message_id: "om_merge", chat_id: "oc_123", msg_type: "merge_forward" },
          {
            body: { content: JSON.stringify({ text: "hello" }) },
            sender: { id: "ou_human", id_type: "open_id", sender_type: "user" },
            msg_type: "text",
          },
        ],
      },
    });

    const first = await getMessageFeishu({ cfg: {} as any, messageId: "om_merge" });
    const second = await getMessageFeishu({ cfg: {} as any, messageId: "om_merge" });

    expect(first?.content).toBe("[Alice Human] hello");
    expect(second?.content).toBe("[Alice Human] hello");
    expect(client.contact.user.get).toHaveBeenCalledTimes(1);
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
