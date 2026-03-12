import { Type, type Static } from "@sinclair/typebox";

function stringEnum<T extends readonly string[]>(
  values: T,
  options: { description?: string; default?: T[number] } = {},
) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
}

const VOICE_ACTION_VALUES = ["send", "debug", "set_mode"] as const;
const VOICE_MODE_VALUES = ["voice", "text", "auto"] as const;

export const FeishuVoiceSchema = Type.Object({
  action: stringEnum(VOICE_ACTION_VALUES, {
    description:
      "Voice tool action: send a voice message, debug local TTS availability, or set temporary voice/text/auto mode",
  }),
  text: Type.Optional(
    Type.String({
      description: "Text to synthesize into voice. Required when action=send.",
    }),
  ),
  target: Type.Optional(
    Type.String({
      description:
        "Optional explicit target. Examples: user:ou_xxx, chat:oc_xxx, ou_xxx, oc_xxx. Omit to reply in the current conversation.",
    }),
  ),
  reply_to_message_id: Type.Optional(
    Type.String({
      description:
        "Optional explicit reply message ID. If omitted and target is omitted, the current conversation reply target is used automatically.",
    }),
  ),
  mode: Type.Optional(
    stringEnum(VOICE_MODE_VALUES, {
      description: 'Mode for action=set_mode: "voice", "text", or "auto"',
    }),
  ),
  duration_minutes: Type.Optional(
    Type.Number({
      minimum: 1,
      description:
        'Optional duration in minutes for action=set_mode. When omitted, "voice" and "text" default to 60 minutes. Ignored for mode="auto".',
    }),
  ),
});

export type FeishuVoiceParams = Static<typeof FeishuVoiceSchema>;
