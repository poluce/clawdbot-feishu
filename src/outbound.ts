import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getFeishuRuntime } from "./runtime.js";
import { sendMessageFeishu } from "./send.js";
import { sendMediaFeishu } from "./media.js";
import { getTTSUnavailableReason, isTTSAvailable, sendVoiceMessage, shouldSendAsVoice } from "./tts.js";

export const feishuOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getFeishuRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text, accountId }) => {
    const channelCfg = cfg.channels?.clawdbot_feishu as
      | { tts?: { enabled?: boolean; force?: boolean } }
      | undefined;
    const ttsEnabled = channelCfg?.tts?.enabled !== false;
    const forceVoice = channelCfg?.tts?.force === true;
    const ttsAvailable = ttsEnabled ? isTTSAvailable() : false;

    if (ttsEnabled && ttsAvailable && (forceVoice || shouldSendAsVoice(text))) {
      try {
        const result = await sendVoiceMessage({ cfg, to, text, accountId });
        return { channel: "clawdbot_feishu", ...result };
      } catch (err) {
        console.error("[clawdbot_feishu] sendVoiceMessage failed, falling back to text:", err);
      }
    }
    if (ttsEnabled && forceVoice && !ttsAvailable) {
      console.error(
        `[clawdbot_feishu] force voice requested but ${getTTSUnavailableReason() ?? "TTS is unavailable"}`,
      );
    }
    const result = await sendMessageFeishu({ cfg, to, text, accountId });
    return { channel: "clawdbot_feishu", ...result };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl, mediaLocalRoots, accountId }) => {
    // Send text first if provided
    if (text?.trim()) {
      await sendMessageFeishu({ cfg, to, text, accountId });
    }

    // Upload and send media if URL provided
    if (mediaUrl) {
      try {
        const result = await sendMediaFeishu({ cfg, to, mediaUrl, mediaLocalRoots, accountId });
        return { channel: "clawdbot_feishu", ...result };
      } catch (err) {
        // Log the error for debugging
        console.error(`[feishu] sendMediaFeishu failed:`, err);
        // Fallback to URL link if upload fails
        const fallbackText = `📎 ${mediaUrl}`;
        const result = await sendMessageFeishu({ cfg, to, text: fallbackText, accountId });
        return { channel: "clawdbot_feishu", ...result };
      }
    }

    // No media URL, just return text result
    const result = await sendMessageFeishu({ cfg, to, text: text ?? "", accountId });
    return { channel: "clawdbot_feishu", ...result };
  },
};
