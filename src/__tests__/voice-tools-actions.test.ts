import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getCurrentFeishuToolContext: vi.fn(),
  getDebugInfo: vi.fn(),
  getTTSUnavailableReason: vi.fn(),
  sendVoiceMessage: vi.fn(),
  setTemporaryMode: vi.fn(),
}));

vi.mock("../tools-common/tool-context.js", () => ({
  getCurrentFeishuToolContext: mocked.getCurrentFeishuToolContext,
}));

vi.mock("../tts.js", () => ({
  getDebugInfo: mocked.getDebugInfo,
  getTTSUnavailableReason: mocked.getTTSUnavailableReason,
  sendVoiceMessage: mocked.sendVoiceMessage,
  setTemporaryMode: mocked.setTemporaryMode,
}));

import {
  getVoiceToolDebugInfo,
  sendVoiceToolMessage,
  setVoiceToolMode,
} from "../voice-tools/actions.js";

describe("voice-tools/actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getDebugInfo.mockReturnValue({ ttsAvailable: true });
    mocked.getTTSUnavailableReason.mockReturnValue(undefined);
  });

  it("sends voice to an explicit target", async () => {
    mocked.sendVoiceMessage.mockResolvedValue({ messageId: "om_1", chatId: "ou_1" });

    await expect(
      sendVoiceToolMessage({
        cfg: {} as any,
        accountId: "acc",
        text: "hello",
        target: "user:ou_1",
      }),
    ).resolves.toEqual({
      ok: true,
      message_id: "om_1",
      chat_id: "ou_1",
      target: "user:ou_1",
      target_source: "explicit",
      reply_to_message_id: undefined,
    });
  });

  it("uses current conversation context when target is omitted", async () => {
    mocked.getCurrentFeishuToolContext.mockReturnValue({
      chatId: "oc_123",
      replyToMessageId: "om_root",
    });
    mocked.sendVoiceMessage.mockResolvedValue({ messageId: "om_2", chatId: "oc_123" });

    await expect(
      sendVoiceToolMessage({
        cfg: {} as any,
        accountId: "acc",
        text: "hello",
      }),
    ).resolves.toMatchObject({
      target: "oc_123",
      target_source: "context",
      reply_to_message_id: "om_root",
    });
  });

  it("throws when text is empty or target cannot be inferred", async () => {
    await expect(
      sendVoiceToolMessage({
        cfg: {} as any,
        accountId: "acc",
        text: "   ",
      }),
    ).rejects.toThrow("text is required");

    mocked.getCurrentFeishuToolContext.mockReturnValue(undefined);
    await expect(
      sendVoiceToolMessage({
        cfg: {} as any,
        accountId: "acc",
        text: "hello",
      }),
    ).rejects.toThrow("target is required");
  });

  it("returns voice debug info with unavailable reason", () => {
    mocked.getDebugInfo.mockReturnValue({ ttsAvailable: false });
    mocked.getTTSUnavailableReason.mockReturnValue("missing edge-tts");

    expect(getVoiceToolDebugInfo()).toEqual({
      ttsAvailable: false,
      unavailableReason: "missing edge-tts",
    });
  });

  it("sets temporary voice mode with default and explicit durations", () => {
    expect(
      setVoiceToolMode({
        mode: "text",
      }),
    ).toMatchObject({
      ok: true,
      mode: "text",
      duration_minutes: 60,
      scope: "temporary",
    });
    expect(mocked.setTemporaryMode).toHaveBeenLastCalledWith("text", 60 * 60_000);

    expect(
      setVoiceToolMode({
        mode: "auto",
      }),
    ).toMatchObject({
      ok: true,
      mode: "auto",
      duration_minutes: undefined,
    });
    expect(mocked.setTemporaryMode).toHaveBeenLastCalledWith("auto", undefined);

    expect(
      setVoiceToolMode({
        mode: "voice",
        durationMinutes: 15,
      }),
    ).toMatchObject({
      ok: true,
      mode: "voice",
      duration_minutes: 15,
    });
    expect(mocked.setTemporaryMode).toHaveBeenLastCalledWith("voice", 15 * 60_000);
  });
});
