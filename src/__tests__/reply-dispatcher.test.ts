import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const state: { deliver?: (payload: any, info?: any) => Promise<void> } = {};
  return {
    state,
    createReplyPrefixContext: vi.fn(() => ({
      responsePrefix: "",
      responsePrefixContextProvider: undefined,
      onModelSelected: vi.fn(),
    })),
    createTypingCallbacks: vi.fn(() => ({
      onReplyStart: vi.fn(),
      onIdle: vi.fn(),
      onCleanup: vi.fn(),
    })),
    logTypingFailure: vi.fn(),
    resolveFeishuAccount: vi.fn(),
    createFeishuClient: vi.fn(() => ({})),
    buildMentionedCardContent: vi.fn((mentions, text) => `${mentions.length}:${text}`),
    normalizeFeishuMarkdownLinks: vi.fn((text) => text),
    getFeishuRuntime: vi.fn(),
    sendMarkdownCardFeishu: vi.fn(),
    sendMessageFeishu: vi.fn(),
    FeishuStreamingSession: vi.fn(),
    resolveReceiveIdType: vi.fn(() => "chat_id"),
    getTTSUnavailableReason: vi.fn(() => "TTS unavailable: missing edge-tts"),
    isTTSAvailable: vi.fn(),
    sendVoiceMessage: vi.fn(),
    shouldSendAsVoice: vi.fn(),
    updateInteraction: vi.fn(),
    addTypingIndicator: vi.fn(),
    removeTypingIndicator: vi.fn(),
  };
});

vi.mock("openclaw/plugin-sdk", () => ({
  createReplyPrefixContext: mocked.createReplyPrefixContext,
  createTypingCallbacks: mocked.createTypingCallbacks,
  logTypingFailure: mocked.logTypingFailure,
}));

vi.mock("../accounts.js", () => ({
  resolveFeishuAccount: mocked.resolveFeishuAccount,
}));

vi.mock("../client.js", () => ({
  createFeishuClient: mocked.createFeishuClient,
}));

vi.mock("../mention.js", () => ({
  buildMentionedCardContent: mocked.buildMentionedCardContent,
}));

vi.mock("../text/markdown-links.js", () => ({
  normalizeFeishuMarkdownLinks: mocked.normalizeFeishuMarkdownLinks,
}));

vi.mock("../runtime.js", () => ({
  getFeishuRuntime: mocked.getFeishuRuntime,
}));

vi.mock("../send.js", () => ({
  sendMarkdownCardFeishu: mocked.sendMarkdownCardFeishu,
  sendMessageFeishu: mocked.sendMessageFeishu,
}));

vi.mock("../streaming-card.js", () => ({
  FeishuStreamingSession: mocked.FeishuStreamingSession,
}));

vi.mock("../targets.js", () => ({
  resolveReceiveIdType: mocked.resolveReceiveIdType,
}));

vi.mock("../tts.js", () => ({
  getTTSUnavailableReason: mocked.getTTSUnavailableReason,
  isTTSAvailable: mocked.isTTSAvailable,
  sendVoiceMessage: mocked.sendVoiceMessage,
  shouldSendAsVoice: mocked.shouldSendAsVoice,
  updateInteraction: mocked.updateInteraction,
}));

vi.mock("../typing.js", () => ({
  addTypingIndicator: mocked.addTypingIndicator,
  removeTypingIndicator: mocked.removeTypingIndicator,
}));

import { createFeishuReplyDispatcher } from "../reply-dispatcher.js";

function setupReplyDispatcher(configOverrides?: Record<string, unknown>) {
  const runtime = {
    log: vi.fn(),
    error: vi.fn(),
  };

  mocked.resolveFeishuAccount.mockReturnValue({
    accountId: "acc",
    appId: "cli_xxx",
    appSecret: "secret",
    domain: "feishu",
    config: {
      renderMode: "auto",
      streaming: false,
      tts: {
        enabled: true,
        force: false,
      },
      ...(configOverrides ?? {}),
    },
  });

  mocked.getFeishuRuntime.mockReturnValue({
    channel: {
      text: {
        resolveTextChunkLimit: vi.fn(() => 4000),
        resolveChunkMode: vi.fn(() => "length"),
        resolveMarkdownTableMode: vi.fn(() => "ascii"),
        convertMarkdownTables: vi.fn((text: string) => `converted:${text}`),
        chunkTextWithMode: vi.fn((text: string) => [text]),
      },
      reply: {
        resolveHumanDelayConfig: vi.fn(() => undefined),
        createReplyDispatcherWithTyping: vi.fn((params: any) => {
          mocked.state.deliver = params.deliver;
          return {
            dispatcher: {},
            replyOptions: {},
            markDispatchIdle: vi.fn(),
          };
        }),
      },
    },
  });

  createFeishuReplyDispatcher({
    cfg: {} as any,
    agentId: "agent",
    runtime: runtime as any,
    chatId: "oc_123",
    replyToMessageId: "om_123",
    mentionTargets: [{ openId: "ou_1", name: "Alice", key: "@_user_1" }],
    accountId: "acc",
    userMessageText: "hello",
  });

  if (!mocked.state.deliver) {
    throw new Error("deliver callback was not captured");
  }

  return { runtime, deliver: mocked.state.deliver };
}

describe("reply-dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.state.deliver = undefined;
    mocked.isTTSAvailable.mockReturnValue(false);
    mocked.shouldSendAsVoice.mockReturnValue(false);
  });

  it("sends voice when TTS is selected", async () => {
    mocked.isTTSAvailable.mockReturnValue(true);
    mocked.shouldSendAsVoice.mockReturnValue(true);
    const { deliver } = setupReplyDispatcher();

    await deliver({ text: "Short reply" }, { kind: "final" });

    expect(mocked.sendVoiceMessage).toHaveBeenCalledWith({
      cfg: {},
      to: "oc_123",
      text: "Short reply",
      replyToMessageId: "om_123",
      accountId: "acc",
    });
    expect(mocked.sendMessageFeishu).not.toHaveBeenCalled();
    expect(mocked.sendMarkdownCardFeishu).not.toHaveBeenCalled();
  });

  it("falls back to text when voice sending fails", async () => {
    mocked.isTTSAvailable.mockReturnValue(true);
    mocked.shouldSendAsVoice.mockReturnValue(true);
    mocked.sendVoiceMessage.mockRejectedValue(new Error("tts failed"));
    const { runtime, deliver } = setupReplyDispatcher({ renderMode: "raw" });

    await deliver({ text: "hello" }, { kind: "final" });

    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("voice send failed, falling back to text"),
    );
    expect(mocked.sendMessageFeishu).toHaveBeenCalledWith({
      cfg: {},
      to: "oc_123",
      text: "converted:hello",
      replyToMessageId: "om_123",
      mentions: [{ openId: "ou_1", name: "Alice", key: "@_user_1" }],
      accountId: "acc",
    });
  });

  it("uses markdown cards when auto render detects structured content", async () => {
    const { deliver } = setupReplyDispatcher();

    await deliver({ text: "```ts\nconst x = 1;\n```" }, { kind: "final" });

    expect(mocked.sendMarkdownCardFeishu).toHaveBeenCalledWith({
      cfg: {},
      to: "oc_123",
      text: "```ts\nconst x = 1;\n```",
      replyToMessageId: "om_123",
      mentions: [{ openId: "ou_1", name: "Alice", key: "@_user_1" }],
      accountId: "acc",
    });
    expect(mocked.sendMessageFeishu).not.toHaveBeenCalled();
  });

  it("logs unavailable forced voice and falls back to text", async () => {
    const { runtime, deliver } = setupReplyDispatcher({
      tts: {
        enabled: true,
        force: true,
      },
    });

    await deliver({ text: "plain text" }, { kind: "final" });

    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("force voice requested but TTS unavailable"),
    );
    expect(mocked.sendMessageFeishu).toHaveBeenCalled();
  });

  it("skips non-card block chunks when streaming card mode is not active", async () => {
    const { deliver } = setupReplyDispatcher({ renderMode: "raw" });

    await deliver({ text: "block text" }, { kind: "block" });

    expect(mocked.sendVoiceMessage).not.toHaveBeenCalled();
    expect(mocked.sendMessageFeishu).not.toHaveBeenCalled();
    expect(mocked.sendMarkdownCardFeishu).not.toHaveBeenCalled();
  });
});
