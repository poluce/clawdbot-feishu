/**
 * TTS (Text-to-Speech) module for Feishu
 * Generates audio using local sherpa-onnx and sends as voice message
 */
import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { uploadFileFeishu, sendAudioFeishu, type SendMediaResult } from "./media.js";

// TTS Configuration
const TTS_CONFIG = {
  runtime: `${os.homedir()}/.openclaw/tools/sherpa-onnx-tts/runtime/bin/sherpa-onnx-offline-tts`,
  models: {
    zh: {
      dir: `${os.homedir()}/.openclaw/tools/sherpa-onnx-tts/models/vits-zh-hf-fanchen-C`,
      model: "vits-zh-hf-fanchen-C.onnx",
      lengthScale: 0.65, // 裴总偏好：较快语速
    },
    "zh-en": {
      dir: `${os.homedir()}/.openclaw/tools/sherpa-onnx-tts/models/vits-melo-tts-zh_en`,
      model: "model.onnx",
      lengthScale: 0.8, // 裴总偏好：中英混合稍慢
    },
  },
  timezone: "Asia/Shanghai",
};

/**
 * Check if text contains English words
 */
function containsEnglish(text: string): boolean {
  return /[a-zA-Z]{2,}/.test(text);
}

/**
 * Check if content should use text instead of voice
 * - Code/programming content
 * - Long/complex content (>300 chars)
 * - Content with code blocks, tables, or formatted lists
 */
export function shouldUseText(text: string): boolean {
  // Code blocks
  if (/```[\s\S]*```/.test(text)) return true;
  // Inline code (multiple occurrences)
  if ((text.match(/`[^`]+`/g) || []).length > 2) return true;
  // Tables
  if (/\|.*\|.*\|/.test(text)) return true;
  // Long content (>150 chars for Chinese, >300 for English)
  if (text.length > 150) return true;
  // Technical keywords
  const techKeywords = /\b(function|const|let|var|import|export|class|interface|type|async|await|return|if|else|for|while|npm|git|docker|api|http|json|xml|sql|bash|shell|python|javascript|typescript|node|react|vue)\b/i;
  if (techKeywords.test(text)) return true;
  
  return false;
}

/**
 * Check if current time prefers voice based on 裴总's schedule
 * 
 * 工作日 (Mon-Fri):
 * - 07:00-08:30: 通勤（开车去公司）→ 语音
 * - 08:30-12:00: 上班 → 文本
 * - 12:00-13:00: 午休 → 语音
 * - 13:00-17:30: 上班 → 文本
 * - 17:30-19:00: 通勤（开车回家）→ 语音
 * - 19:00-07:00: 下班/休息 → 语音
 * 
 * 周末/节假日: 优先语音
 */
export function shouldUseVoiceByTime(): boolean {
  const now = new Date();
  // Convert to Shanghai timezone
  const shanghaiTime = new Date(now.toLocaleString("en-US", { timeZone: TTS_CONFIG.timezone }));
  const day = shanghaiTime.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const hour = shanghaiTime.getHours();
  const minute = shanghaiTime.getMinutes();
  const timeValue = hour * 60 + minute; // Minutes since midnight

  // Weekend: prefer voice
  if (day === 0 || day === 6) {
    return true;
  }

  // Weekday time slots (in minutes)
  const COMMUTE_MORNING_START = 7 * 60;      // 07:00
  const COMMUTE_MORNING_END = 8 * 60 + 30;   // 08:30
  const WORK_MORNING_END = 12 * 60;          // 12:00
  const LUNCH_END = 13 * 60;                 // 13:00
  const WORK_AFTERNOON_END = 17 * 60 + 30;   // 17:30
  const COMMUTE_EVENING_END = 19 * 60;       // 19:00

  // Morning commute: voice
  if (timeValue >= COMMUTE_MORNING_START && timeValue < COMMUTE_MORNING_END) {
    return true;
  }
  // Morning work: text
  if (timeValue >= COMMUTE_MORNING_END && timeValue < WORK_MORNING_END) {
    return false;
  }
  // Lunch break: voice
  if (timeValue >= WORK_MORNING_END && timeValue < LUNCH_END) {
    return true;
  }
  // Afternoon work: text
  if (timeValue >= LUNCH_END && timeValue < WORK_AFTERNOON_END) {
    return false;
  }
  // Evening commute: voice
  if (timeValue >= WORK_AFTERNOON_END && timeValue < COMMUTE_EVENING_END) {
    return true;
  }
  // Night/early morning: voice
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
  const useZhEn = containsEnglish(text);
  const modelConfig = useZhEn ? TTS_CONFIG.models["zh-en"] : TTS_CONFIG.models.zh;
  
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const wavPath = path.join(tmpDir, `tts_${timestamp}.wav`);
  const opusPath = path.join(tmpDir, `tts_${timestamp}.opus`);

  // Generate WAV using sherpa-onnx
  const ttsCmd = [
    TTS_CONFIG.runtime,
    `--vits-model=${modelConfig.dir}/${modelConfig.model}`,
    `--vits-lexicon=${modelConfig.dir}/lexicon.txt`,
    `--vits-tokens=${modelConfig.dir}/tokens.txt`,
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
  try {
    return (
      fs.existsSync(TTS_CONFIG.runtime) &&
      fs.existsSync(TTS_CONFIG.models.zh.dir) &&
      fs.existsSync(TTS_CONFIG.models["zh-en"].dir)
    );
  } catch {
    return false;
  }
}
