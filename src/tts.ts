/**
 * TTS (Text-to-Speech) module for Feishu
 * Generates audio using local sherpa-onnx and sends as voice message
 * 
 * Configuration loaded from skill.json
 */
import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { uploadFileFeishu, sendAudioFeishu, type SendMediaResult } from "./media.js";

// Skill config path
const SKILL_CONFIG_PATH = `${os.homedir()}/.openclaw/workspace/skills/feishu-voice/skill.json`;

// Default config (fallback if skill.json not found)
const DEFAULT_CONFIG = {
  models: {
    zh: { name: "vits-zh-hf-fanchen-C", lengthScale: 0.65 },
    "zh-en": { name: "vits-melo-tts-zh_en", lengthScale: 0.8 },
  },
  rules: {
    forceText: {
      maxChars: 150,
      codeBlocks: true,
      tables: true,
      techKeywords: true,
    },
    schedule: {
      timezone: "Asia/Shanghai",
      weekday: {
        "07:00-08:30": "voice",
        "08:30-12:00": "text",
        "12:00-13:00": "voice",
        "13:00-17:30": "text",
        "17:30-19:00": "voice",
        "19:00-07:00": "voice",
      },
      weekend: "voice",
    },
  },
};

// TTS paths
const TTS_RUNTIME = `${os.homedir()}/.openclaw/tools/sherpa-onnx-tts/runtime/bin/sherpa-onnx-offline-tts`;
const TTS_MODELS_DIR = `${os.homedir()}/.openclaw/tools/sherpa-onnx-tts/models`;

/**
 * Load skill configuration
 */
function loadConfig(): typeof DEFAULT_CONFIG {
  try {
    if (fs.existsSync(SKILL_CONFIG_PATH)) {
      const raw = fs.readFileSync(SKILL_CONFIG_PATH, "utf-8");
      const json = JSON.parse(raw);
      return {
        models: { ...DEFAULT_CONFIG.models, ...json.config?.models },
        rules: {
          forceText: { ...DEFAULT_CONFIG.rules.forceText, ...json.config?.rules?.forceText },
          schedule: { ...DEFAULT_CONFIG.rules.schedule, ...json.config?.rules?.schedule },
        },
      };
    }
  } catch (e) {
    console.error("Failed to load skill config:", e);
  }
  return DEFAULT_CONFIG;
}

/**
 * Check if text contains English words
 */
function containsEnglish(text: string): boolean {
  return /[a-zA-Z]{2,}/.test(text);
}

/**
 * Parse time string "HH:MM" to minutes since midnight
 */
function parseTime(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Check if content should use text instead of voice
 */
export function shouldUseText(text: string): boolean {
  const config = loadConfig();
  const rules = config.rules.forceText;

  // Code blocks
  if (rules.codeBlocks && /```[\s\S]*```/.test(text)) return true;
  // Inline code (multiple occurrences)
  if (rules.codeBlocks && (text.match(/`[^`]+`/g) || []).length > 2) return true;
  // Tables
  if (rules.tables && /\|.*\|.*\|/.test(text)) return true;
  // Long content
  if (text.length > rules.maxChars) return true;
  // Technical keywords
  if (rules.techKeywords) {
    const techKeywords = /\b(function|const|let|var|import|export|class|interface|type|async|await|return|if|else|for|while|npm|git|docker|api|http|json|xml|sql|bash|shell|python|javascript|typescript|node|react|vue)\b/i;
    if (techKeywords.test(text)) return true;
  }

  return false;
}

/**
 * Check if current time prefers voice based on schedule config
 */
export function shouldUseVoiceByTime(): boolean {
  const config = loadConfig();
  const schedule = config.rules.schedule;

  const now = new Date();
  const shanghaiTime = new Date(now.toLocaleString("en-US", { timeZone: schedule.timezone }));
  const day = shanghaiTime.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const hour = shanghaiTime.getHours();
  const minute = shanghaiTime.getMinutes();
  const currentTime = hour * 60 + minute;

  // Weekend
  if (day === 0 || day === 6) {
    return schedule.weekend === "voice";
  }

  // Weekday - check time slots
  const weekdayRules = schedule.weekday;
  for (const [timeRange, mode] of Object.entries(weekdayRules)) {
    const [startStr, endStr] = timeRange.split("-");
    const start = parseTime(startStr);
    const end = parseTime(endStr);

    // Handle overnight ranges (e.g., 19:00-07:00)
    if (start > end) {
      if (currentTime >= start || currentTime < end) {
        return mode === "voice";
      }
    } else {
      if (currentTime >= start && currentTime < end) {
        return mode === "voice";
      }
    }
  }

  // Default to voice if no rule matches
  return true;
}

/**
 * Determine if response should be sent as voice
 */
export function shouldSendAsVoice(text: string): boolean {
  // Content check first (code/complex content always text)
  if (shouldUseText(text)) {
    return false;
  }
  // Then check time preference
  return shouldUseVoiceByTime();
}

/**
 * Generate TTS audio file from text
 */
export async function generateTTS(text: string): Promise<{ wavPath: string; opusPath: string; durationMs: number }> {
  const config = loadConfig();
  const useZhEn = containsEnglish(text);
  const modelConfig = useZhEn ? config.models["zh-en"] : config.models.zh;
  const modelDir = `${TTS_MODELS_DIR}/${modelConfig.name}`;

  // Find model file
  let modelFile = `${modelConfig.name}.onnx`;
  if (!fs.existsSync(`${modelDir}/${modelFile}`)) {
    // Try model.onnx for melo models
    modelFile = "model.onnx";
  }

  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const wavPath = path.join(tmpDir, `tts_${timestamp}.wav`);
  const opusPath = path.join(tmpDir, `tts_${timestamp}.opus`);

  // Generate WAV using sherpa-onnx
  const ttsCmd = [
    TTS_RUNTIME,
    `--vits-model=${modelDir}/${modelFile}`,
    `--vits-lexicon=${modelDir}/lexicon.txt`,
    `--vits-tokens=${modelDir}/tokens.txt`,
    `--vits-length-scale=${modelConfig.lengthScale}`,
    `--output-filename=${wavPath}`,
    `"${text.replace(/"/g, '\\"')}"`,
  ].join(" ");

  execSync(ttsCmd, { stdio: "pipe" });

  // Convert to opus
  execSync(`ffmpeg -y -i "${wavPath}" -acodec libopus -ac 1 -ar 16000 "${opusPath}"`, {
    stdio: "pipe",
  });

  // Get duration
  const durationStr = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${opusPath}"`,
  ).toString().trim();
  const durationMs = Math.round(parseFloat(durationStr) * 1000);

  // Cleanup WAV
  fs.unlinkSync(wavPath);

  return { wavPath, opusPath, durationMs };
}

/**
 * Send text as voice message
 */
export async function sendVoiceMessage(params: {
  cfg: ClawdbotConfig;
  to: string;
  text: string;
  replyToMessageId?: string;
}): Promise<SendMediaResult> {
  const { cfg, to, text, replyToMessageId } = params;

  // Generate TTS
  const { opusPath, durationMs } = await generateTTS(text);

  try {
    // Upload to Feishu
    const { fileKey } = await uploadFileFeishu({
      cfg,
      file: opusPath,
      fileName: "voice.opus",
      fileType: "opus",
      duration: durationMs,
    });

    // Send as audio message
    return await sendAudioFeishu({
      cfg,
      to,
      fileKey,
      replyToMessageId,
    });
  } finally {
    // Cleanup opus file
    if (fs.existsSync(opusPath)) {
      fs.unlinkSync(opusPath);
    }
  }
}

/**
 * Check if TTS is available (runtime and models exist)
 */
export function isTTSAvailable(): boolean {
  const config = loadConfig();
  try {
    const zhModelDir = `${TTS_MODELS_DIR}/${config.models.zh.name}`;
    const zhEnModelDir = `${TTS_MODELS_DIR}/${config.models["zh-en"].name}`;
    return (
      fs.existsSync(TTS_RUNTIME) &&
      fs.existsSync(zhModelDir) &&
      fs.existsSync(zhEnModelDir)
    );
  } catch {
    return false;
  }
}

/**
 * Get current config (for debugging)
 */
export function getConfig() {
  return loadConfig();
}
