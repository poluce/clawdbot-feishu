import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const state: {
    deliver?: (payload: any, info?: any) => Promise<void>;
    replyHooks?: any;
    typingHooks?: any;
    streamingInstance?: any;
  } = {};
  return {
    state,
    createReplyPrefixContext: vi.fn(() => ({
      responsePrefix: "",
      responsePrefixContextProvider: undefined,
      onModelSelected: vi.fn(),
    })),
    createTypingCallbacks: vi.fn((hooks: any) => {
      state.typingHooks = hooks;
      return {
        onReplyStart: vi.fn(),
        onIdle: vi.fn(),
        onCleanup: vi.fn(),
      };
    }),
    logTypingFailure: vi.fn(),
    resolveFeishuAccount: vi.fn(),
    createFeishuClient: vi.fn(() => ({})),
    buildMentionedCardContent: vi.fn((mentions, text) => `${mentions.length}:${text}`),
    normalizeFeishuMarkdownLinks: vi.fn((text) => text),
    getFeishuRuntime: vi.fn(),
    sendMarkdownCardFeishu: vi.fn(),
    sendMessageFeishu: vi.fn(),
    FeishuStreamingSession: vi.fn((..._args: any[]) => {
      const instance = {
        start: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn(() => true),
      };
      state.streamingInstance = instance;
      return instance;
    }),
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

function setupReplyDispatcher(
  configOverrides?: Record<string, unknown>,
  paramsOverrides?: Record<string, unknown>,
  accountOverrides?: Record<string, unknown>,
) {
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
    ...(accountOverrides ?? {}),
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
          mocked.state.replyHooks = params;
          return {
            dispatcher: {},
            replyOptions: {},
            markDispatchIdle: vi.fn(),
          };
        }),
      },
    },
  });

  const result = createFeishuReplyDispatcher({
    cfg: {} as any,
    agentId: "agent",
    runtime: runtime as any,
    chatId: "oc_123",
    replyToMessageId: "om_123",
    mentionTargets: [{ openId: "ou_1", name: "Alice", key: "@_user_1" }],
    accountId: "acc",
    userMessageText: "hello",
    userInputMode: "text",
    messageCreateTimeMs: Date.now(),
    ...(paramsOverrides ?? {}),
  });

  if (!mocked.state.deliver) {
    throw new Error("deliver callback was not captured");
  }

  return { runtime, deliver: mocked.state.deliver, result };
}

describe("reply-dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.state.deliver = undefined;
    mocked.state.replyHooks = undefined;
    mocked.state.typingHooks = undefined;
    mocked.state.streamingInstance = undefined;
    mocked.isTTSAvailable.mockReturnValue(false);
    mocked.shouldSendAsVoice.mockReturnValue(false);
  });

  it("sends voice when TTS is selected", async () => {
    mocked.isTTSAvailable.mockReturnValue(true);
    mocked.shouldSendAsVoice.mockReturnValue(true);
    const { deliver } = setupReplyDispatcher();

    expect(mocked.updateInteraction).toHaveBeenCalledWith("text");
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

  it("returns early for empty text payloads", async () => {
    const { deliver } = setupReplyDispatcher();
    await deliver({ text: "   " }, { kind: "final" });
    expect(mocked.sendVoiceMessage).not.toHaveBeenCalled();
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

  it("starts streaming for block chunks in card mode", async () => {
    const { deliver } = setupReplyDispatcher({
      renderMode: "card",
      streaming: true,
    });
    mocked.state.replyHooks.onReplyStart();

    await deliver({ text: "block card" }, { kind: "block" });
    expect(mocked.state.streamingInstance?.start).toHaveBeenCalled();
  });

  it("updates and closes streaming cards when streaming is enabled", async () => {
    const { deliver, result } = setupReplyDispatcher({
      renderMode: "card",
      streaming: true,
    });

    mocked.state.replyHooks.onReplyStart();
    expect(mocked.state.streamingInstance?.start).toHaveBeenCalledWith(
      "oc_123",
      "chat_id",
      "om_123",
    );

    result.replyOptions.onPartialReply?.({ text: "partial 1" });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocked.state.streamingInstance?.update).toHaveBeenCalledWith("partial 1");

    await deliver({ text: "final text" }, { kind: "final" });
    expect(mocked.state.streamingInstance?.close).toHaveBeenCalledWith("1:final text");
  });

  it("mirrors block text into active streaming sessions", async () => {
    const { deliver } = setupReplyDispatcher({
      renderMode: "card",
      streaming: true,
    });
    mocked.state.replyHooks.onReplyStart();

    await deliver({ text: "block text" }, { kind: "block" });
    await mocked.state.replyHooks.onIdle();
    expect(mocked.state.streamingInstance?.close).toHaveBeenCalledWith("1:block text");
  });

  it("ignores empty partial replies while streaming", async () => {
    const { result } = setupReplyDispatcher({
      renderMode: "card",
      streaming: true,
    });
    mocked.state.replyHooks.onReplyStart();

    result.replyOptions.onPartialReply?.({ text: "" });
    await Promise.resolve();
    expect(mocked.state.streamingInstance?.update).not.toHaveBeenCalled();
  });

  it("handles cumulative partial replies without duplicating trailing text", async () => {
    const { result } = setupReplyDispatcher({
      renderMode: "card",
      streaming: true,
    });
    mocked.state.replyHooks.onReplyStart();

    result.replyOptions.onPartialReply?.({ text: "hello" });
    result.replyOptions.onPartialReply?.({ text: "hello world" });
    await mocked.state.replyHooks.onIdle();

    expect(mocked.state.streamingInstance?.close).toHaveBeenCalledWith("1:hello world");
  });

  it("skips streaming start when credentials are incomplete", async () => {
    const { result } = setupReplyDispatcher({
      renderMode: "card",
      streaming: true,
    }, undefined, {
      appId: undefined,
      appSecret: undefined,
    });

    mocked.state.replyHooks.onReplyStart();
    expect(mocked.FeishuStreamingSession).not.toHaveBeenCalled();
    await result.replyOptions.onPartialReply?.({ text: "hello" });
  });

  it("logs streaming start failures", async () => {
    mocked.FeishuStreamingSession.mockImplementationOnce(() => {
      const instance = {
        start: vi.fn().mockRejectedValue(new Error("stream start failed")),
        update: vi.fn(),
        close: vi.fn(),
        isActive: vi.fn(() => false),
      };
      mocked.state.streamingInstance = instance;
      return instance;
    });
    const { runtime } = setupReplyDispatcher({
      renderMode: "card",
      streaming: true,
    });

    mocked.state.replyHooks.onReplyStart();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.error).toHaveBeenCalledWith(
      "feishu: streaming start failed: Error: stream start failed",
    );
  });

  it("cleans up streaming sessions on error and idle", async () => {
    setupReplyDispatcher({
      renderMode: "card",
      streaming: true,
    });
    mocked.state.replyHooks.onReplyStart();

    await mocked.state.replyHooks.onError(new Error("boom"), { kind: "final" });
    expect(mocked.state.streamingInstance?.close).toHaveBeenCalled();

    mocked.state.replyHooks.onCleanup();
    await mocked.state.replyHooks.onIdle();
    expect(mocked.state.streamingInstance?.close).toHaveBeenCalled();
  });

  it("starts and stops typing indicators for fresh messages", async () => {
    mocked.addTypingIndicator.mockResolvedValue({ reactionId: "r1" });
    setupReplyDispatcher({ renderMode: "raw" });

    await mocked.state.typingHooks.start();
    expect(mocked.addTypingIndicator).toHaveBeenCalled();
    await mocked.state.typingHooks.stop();
    expect(mocked.removeTypingIndicator).toHaveBeenCalledWith({
      cfg: {},
      state: { reactionId: "r1" },
      accountId: "acc",
    });
  });

  it("skips typing indicator when replyToMessageId is missing", async () => {
    setupReplyDispatcher({ renderMode: "raw" }, { replyToMessageId: undefined });
    await mocked.state.typingHooks.start();
    expect(mocked.addTypingIndicator).not.toHaveBeenCalled();
  });

  it("suppresses typing indicator start for stale messages", async () => {
    mocked.addTypingIndicator.mockResolvedValue({ reactionId: "r1" });
    setupReplyDispatcher(
      { renderMode: "raw" },
      { messageCreateTimeMs: Date.now() - 10 * 60_000 },
    );

    await mocked.state.typingHooks.start();
    expect(mocked.addTypingIndicator).not.toHaveBeenCalled();
  });

  it("logs typing indicator failures through callbacks", async () => {
    const startError = new Error("start failed");
    const stopError = new Error("stop failed");
    setupReplyDispatcher();
    mocked.state.typingHooks.onStartError(startError);
    mocked.state.typingHooks.onStopError(stopError);

    expect(mocked.logTypingFailure).toHaveBeenNthCalledWith(1, {
      log: expect.any(Function),
      channel: "clawdbot_feishu",
      action: "start",
      error: startError,
    });
    expect(mocked.logTypingFailure).toHaveBeenNthCalledWith(2, {
      log: expect.any(Function),
      channel: "clawdbot_feishu",
      action: "stop",
      error: stopError,
    });
  });
});
