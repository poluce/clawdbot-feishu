import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { getCurrentFeishuToolContext } from "../tools-common/tool-context.js";
import {
  getDebugInfo,
  getTTSUnavailableReason,
  sendVoiceMessage,
  setTemporaryMode,
} from "../tts.js";

const DEFAULT_MODE_DURATION_MINUTES = 60;

function resolveVoiceTarget(rawTarget?: string): {
  target: string;
  replyToMessageId?: string;
  source: "explicit" | "context";
} {
  const target = rawTarget?.trim();
  if (target) {
    return {
      target,
      source: "explicit",
    };
  }

  const context = getCurrentFeishuToolContext();
  if (!context?.chatId) {
    throw new Error(
      "target is required when feishu_voice is used outside the current conversation context",
    );
  }

  return {
    target: context.chatId,
    replyToMessageId: context.replyToMessageId,
    source: "context",
  };
}

export async function sendVoiceToolMessage(params: {
  cfg: ClawdbotConfig;
  accountId: string;
  text: string;
  target?: string;
  replyToMessageId?: string;
}): Promise<{
  ok: true;
  message_id: string;
  chat_id: string;
  target: string;
  target_source: "explicit" | "context";
  reply_to_message_id?: string;
}> {
  const text = params.text.trim();
  if (!text) {
    throw new Error("text is required for feishu_voice action=send");
  }

  const resolved = resolveVoiceTarget(params.target);
  const result = await sendVoiceMessage({
    cfg: params.cfg,
    to: resolved.target,
    text,
    replyToMessageId: params.replyToMessageId ?? resolved.replyToMessageId,
    accountId: params.accountId,
  });

  return {
    ok: true,
    message_id: result.messageId,
    chat_id: result.chatId,
    target: resolved.target,
    target_source: resolved.source,
    reply_to_message_id: params.replyToMessageId ?? resolved.replyToMessageId,
  };
}

export function getVoiceToolDebugInfo(): Record<string, unknown> {
  return {
    ...getDebugInfo(),
    unavailableReason: getTTSUnavailableReason(),
  };
}

export function setVoiceToolMode(params: {
  mode: "voice" | "text" | "auto";
  durationMinutes?: number;
}): Record<string, unknown> {
  const durationMinutes =
    params.mode === "auto"
      ? undefined
      : Math.max(1, Math.round(params.durationMinutes ?? DEFAULT_MODE_DURATION_MINUTES));
  const durationMs = durationMinutes ? durationMinutes * 60_000 : undefined;

  setTemporaryMode(params.mode, durationMs);

  return {
    ok: true,
    mode: params.mode,
    duration_minutes: durationMinutes,
    scope: "temporary",
    debug: getVoiceToolDebugInfo(),
  };
}
