import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "../tools-common/tool-exec.js";
import { errorResult, json } from "../tools-common/feishu-api.js";
import { getVoiceToolDebugInfo, sendVoiceToolMessage, setVoiceToolMode } from "./actions.js";
import { FeishuVoiceSchema, type FeishuVoiceParams } from "./schemas.js";

export function registerFeishuVoiceTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_voice: No config available, skipping");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config)) {
    api.logger.debug?.("feishu_voice: No Feishu accounts configured, skipping");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config, "voice")) {
    api.logger.debug?.("feishu_voice: voice tool disabled in config");
    return;
  }

  api.registerTool(
    {
      name: "feishu_voice",
      label: "Feishu Voice",
      description:
        'Feishu voice operations. Actions: "send" to synthesize text into a voice message, "debug" to inspect local TTS availability, ' +
        'or "set_mode" to temporarily force voice/text/auto reply mode. When action="send", omit target to reply in the current Feishu conversation automatically.',
      parameters: FeishuVoiceSchema,
      async execute(_toolCallId, params) {
        const p = params as FeishuVoiceParams;
        try {
          return await withFeishuToolClient({
            api,
            toolName: "feishu_voice",
            requiredTool: "voice",
            run: async ({ account }) => {
              if (p.action === "debug") {
                return json(getVoiceToolDebugInfo());
              }

              if (p.action === "set_mode") {
                if (p.mode !== "voice" && p.mode !== "text" && p.mode !== "auto") {
                  throw new Error('mode is required for feishu_voice action="set_mode"');
                }
                return json(
                  setVoiceToolMode({
                    mode: p.mode,
                    durationMinutes: p.duration_minutes,
                  }),
                );
              }

              const result = await sendVoiceToolMessage({
                cfg: api.config!,
                accountId: account.accountId,
                text: p.text ?? "",
                target: p.target,
                replyToMessageId: p.reply_to_message_id,
              });
              return json(result);
            },
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    { name: "feishu_voice" },
  );

  api.logger.debug?.("feishu_voice: Registered feishu_voice tool");
}
