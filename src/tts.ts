/**
 * TTS (Text-to-Speech) module for Feishu
 * 智能语音/文本切换：情境感知 + 习惯学习 + 规则兜底
 */
import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { uploadFileFeishu, sendAudioFeishu, type SendMediaResult } from "./media.js";

// Paths
const SKILL_DIR = `${os.homedir()}/.openclaw/workspace/skills/feishu-voice`;
const SKILL_CONFIG_PATH = `${SKILL_DIR}/skill.json`;
const STATE_PATH = `${SKILL_DIR}/state.json`;
const TTS_RUNTIME = `${os.homedir()}/.openclaw/tools/sherpa-onnx-tts/runtime/bin/sherpa-onnx-offline-tts`;
const TTS_MODELS_DIR = `${os.homedir()}/.openclaw/tools/sherpa-onnx-tts/models`;

// Types
interface VoiceState {
  currentMode: "auto" | "voice" | "text";
  modeSetAt: number | null;
  modeExpiresAt: number | null;
  lastUserInputMode: "voice" | "text" | null;
  lastInteractionAt: number | null;
  corrections: Array<{
    timestamp: number;
    dayOfWeek: number;
    hour: number;
    correctedTo: "voice" | "text";
  }>;
}

interface SkillConfig {
  models: {
    zh: { name: string; lengthScale: number };
    "zh-en": { name: string; lengthScale: number };
  };
  rules: {
    forceText: {
      maxChars: number;
      codeBlocks: boolean;
      tables: boolean;
      techKeywords: boolean;
    };
    schedule: {
      timezone: string;
      weekday: Record<string, "voice" | "text">;
      weekend: "voice" | "text";
    };
    contextKeywords: {
      voice: string[];
      text: string[];
    };
    adaptiveRules: {
      followUserInputMode: boolean;
      longIntervalThresholdMs: number;
      longIntervalPreference: "voice" | "text";
    };
  };
}

// Default config
const DEFAULT_CONFIG: SkillConfig = {
  models: {
    zh: { name: "vits-zh-hf-fanchen-C", lengthScale: 0.65 },
    "zh-en": { name: "vits-melo-tts-zh_en", lengthScale: 0.8 },
  },
  rules: {
    forceText: { maxChars: 150, codeBlocks: true, tables: true, techKeywords: true },
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
    contextKeywords: {
      voice: ["开车", "在路上", "出门", "走路", "地铁", "公交"],
      text: ["到了", "到公司", "开会", "忙", "在办公室"],
    },
    adaptiveRules: {
      followUserInputMode: true,
      longIntervalThresholdMs: 300000,
      longIntervalPreference: "voice",
    },
  },
};

const DEFAULT_STATE: VoiceState = {
  currentMode: "auto",
  modeSetAt: null,
  modeExpiresAt: null,
  lastUserInputMode: null,
  lastInteractionAt: null,
  corrections: [],
};

/**
 * Load skill configuration
 */
function loadConfig(): SkillConfig {
  try {
    if (fs.existsSync(SKILL_CONFIG_PATH)) {
      const raw = fs.readFileSync(SKILL_CONFIG_PATH, "utf-8");
      const json = JSON.parse(raw);
      return {
        models: { ...DEFAULT_CONFIG.models, ...json.config?.models },
        rules: {
          forceText: { ...DEFAULT_CONFIG.rules.forceText, ...json.config?.rules?.forceText },
          schedule: { ...DEFAULT_CONFIG.rules.schedule, ...json.config?.rules?.schedule },
          contextKeywords: { ...DEFAULT_CONFIG.rules.contextKeywords, ...json.config?.rules?.contextKeywords },
          adaptiveRules: { ...DEFAULT_CONFIG.rules.adaptiveRules, ...json.config?.rules?.adaptiveRules },
        },
      };
    }
  } catch (e) {
    console.error("Failed to load skill config:", e);
  }
  return DEFAULT_CONFIG;
}

/**
 * Load state
 */
function loadState(): VoiceState {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const raw = fs.readFileSync(STATE_PATH, "utf-8");
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error("Failed to load state:", e);
  }
  return DEFAULT_STATE;
}

/**
 * Save state
 */
function saveState(state: VoiceState): void {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("Failed to save state:", e);
  }
}

/**
 * Update last interaction time
 */
export function updateInteraction(userInputMode?: "voice" | "text"): void {
  const state = loadState();
  state.lastInteractionAt = Date.now();
  if (userInputMode) {
    state.lastUserInputMode = userInputMode;
  }
  saveState(state);
}

/**
 * Set temporary mode (e.g., user says "用语音")
 */
export function setTemporaryMode(mode: "voice" | "text" | "auto", durationMs?: number): void {
  const state = loadState();
  state.currentMode = mode;
  state.modeSetAt = Date.now();
  state.modeExpiresAt = durationMs ? Date.now() + durationMs : null;
  saveState(state);
}

/**
 * Record a correction (user asked for different mode)
 */
export function recordCorrection(correctedTo: "voice" | "text"): void {
  const state = loadState();
  const now = new Date();
  state.corrections.push({
    timestamp: Date.now(),
    dayOfWeek: now.getDay(),
    hour: now.getHours(),
    correctedTo,
  });
  // Keep only last 50 corrections
  if (state.corrections.length > 50) {
    state.corrections = state.corrections.slice(-50);
  }
  saveState(state);
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
 * Check if content MUST use text (code, long content, etc.)
 */
export function mustUseText(text: string): boolean {
  const config = loadConfig();
  const rules = config.rules.forceText;

  if (rules.codeBlocks && /```[\s\S]*```/.test(text)) return true;
  if (rules.codeBlocks && (text.match(/`[^`]+`/g) || []).length > 2) return true;
  if (rules.tables && /\|.*\|.*\|/.test(text)) return true;
  if (text.length > rules.maxChars) return true;
  if (rules.techKeywords) {
    const techKeywords = /\b(function|const|let|var|import|export|class|interface|type|async|await|return|if|else|for|while|npm|git|docker|api|http|json|xml|sql|bash|shell|python|javascript|typescript|node|react|vue)\b/i;
    if (techKeywords.test(text)) return true;
  }
  return false;
}

/**
 * Detect context from recent user message
 */
export function detectContextFromMessage(userMessage: string): "voice" | "text" | null {
  const config = loadConfig();
  const keywords = config.rules.contextKeywords;

  for (const kw of keywords.voice) {
    if (userMessage.includes(kw)) return "voice";
  }
  for (const kw of keywords.text) {
    if (userMessage.includes(kw)) return "text";
  }
  return null;
}

/**
 * Check schedule-based preference
 */
function getSchedulePreference(): "voice" | "text" {
  const config = loadConfig();
  const schedule = config.rules.schedule;

  const now = new Date();
  const shanghaiTime = new Date(now.toLocaleString("en-US", { timeZone: schedule.timezone }));
  const day = shanghaiTime.getDay();
  const hour = shanghaiTime.getHours();
  const minute = shanghaiTime.getMinutes();
  const currentTime = hour * 60 + minute;

  if (day === 0 || day === 6) {
    return schedule.weekend;
  }

  for (const [timeRange, mode] of Object.entries(schedule.weekday)) {
    const [startStr, endStr] = timeRange.split("-");
    const start = parseTime(startStr);
    const end = parseTime(endStr);

    if (start > end) {
      if (currentTime >= start || currentTime < end) return mode;
    } else {
      if (currentTime >= start && currentTime < end) return mode;
    }
  }
  return "voice";
}

/**
 * Check if there's a learned pattern for current time
 */
function getLearnedPreference(): "voice" | "text" | null {
  const state = loadState();
  if (state.corrections.length < 3) return null;

  const now = new Date();
  const currentDay = now.getDay();
  const currentHour = now.getHours();

  // Find corrections at similar time (same day of week, within 2 hours)
  const relevantCorrections = state.corrections.filter(c => 
    c.dayOfWeek === currentDay && Math.abs(c.hour - currentHour) <= 2
  );

  if (relevantCorrections.length >= 2) {
    // If most recent corrections at this time prefer voice/text, use that
    const recent = relevantCorrections.slice(-3);
    const voiceCount = recent.filter(c => c.correctedTo === "voice").length;
    if (voiceCount >= 2) return "voice";
    if (voiceCount === 0) return "text";
  }
  return null;
}

/**
 * Weight configuration for scoring
 */
const WEIGHTS = {
  contextKeyword: 0.6,      // 情境关键词（开车、到公司）— 最强信号
  userInputMode: 0.3,       // 用户输入方式（发语音/打字）
  schedule: 0.2,            // 时间表
  longInterval: 0.15,       // 间隔较长
  learned: 0.25,            // 学习记录
};

/**
 * Main decision function: should we send as voice?
 * 
 * 混合方案：硬规则 + 软权重
 * 
 * 硬规则（一票否决）：
 * - 代码/长内容 → 强制文本
 * - 临时模式 → 强制该模式
 * 
 * 软权重（多信号叠加）：
 * - 情境关键词 → ±0.5
 * - 用户输入方式 → ±0.35
 * - 时间表 → ±0.25
 * - 间隔长短 → ±0.15
 * - 学习记录 → ±0.3
 * 
 * 得分 > 0 → 语音
 */
export function shouldSendAsVoice(responseText: string, userMessage?: string): boolean {
  // 硬规则1: 代码/长内容 → 强制文本
  if (mustUseText(responseText)) {
    return false;
  }

  const state = loadState();
  const config = loadConfig();

  // 硬规则2: 临时模式 → 强制该模式
  if (state.currentMode !== "auto") {
    if (state.modeExpiresAt && Date.now() > state.modeExpiresAt) {
      setTemporaryMode("auto");
    } else {
      return state.currentMode === "voice";
    }
  }

  // 软权重计算
  let score = 0;
  const factors: string[] = [];

  // 1. 情境关键词
  if (userMessage) {
    const contextMode = detectContextFromMessage(userMessage);
    if (contextMode === "voice") {
      score += WEIGHTS.contextKeyword;
      factors.push(`情境关键词:+${WEIGHTS.contextKeyword}`);
    } else if (contextMode === "text") {
      score -= WEIGHTS.contextKeyword;
      factors.push(`情境关键词:-${WEIGHTS.contextKeyword}`);
    }
  }

  // 2. 用户输入方式
  if (config.rules.adaptiveRules.followUserInputMode && state.lastUserInputMode) {
    if (state.lastUserInputMode === "voice") {
      score += WEIGHTS.userInputMode;
      factors.push(`用户输入:+${WEIGHTS.userInputMode}`);
    } else {
      score -= WEIGHTS.userInputMode;
      factors.push(`用户输入:-${WEIGHTS.userInputMode}`);
    }
  }

  // 3. 时间表
  const schedulePreference = getSchedulePreference();
  if (schedulePreference === "voice") {
    score += WEIGHTS.schedule;
    factors.push(`时间表:+${WEIGHTS.schedule}`);
  } else {
    score -= WEIGHTS.schedule;
    factors.push(`时间表:-${WEIGHTS.schedule}`);
  }

  // 4. 间隔长短
  if (state.lastInteractionAt) {
    const interval = Date.now() - state.lastInteractionAt;
    if (interval > config.rules.adaptiveRules.longIntervalThresholdMs) {
      if (config.rules.adaptiveRules.longIntervalPreference === "voice") {
        score += WEIGHTS.longInterval;
        factors.push(`长间隔:+${WEIGHTS.longInterval}`);
      } else {
        score -= WEIGHTS.longInterval;
        factors.push(`长间隔:-${WEIGHTS.longInterval}`);
      }
    }
  }

  // 5. 学习记录
  const learned = getLearnedPreference();
  if (learned === "voice") {
    score += WEIGHTS.learned;
    factors.push(`学习记录:+${WEIGHTS.learned}`);
  } else if (learned === "text") {
    score -= WEIGHTS.learned;
    factors.push(`学习记录:-${WEIGHTS.learned}`);
  }

  // 保存计算过程用于调试
  (globalThis as any).__lastVoiceScore = { score, factors };

  return score > 0;
}

/**
 * Get explanation of current decision (for debugging)
 */
export function explainDecision(responseText: string, userMessage?: string): string {
  if (mustUseText(responseText)) {
    return "【硬规则】内容包含代码/过长，强制文本";
  }

  const state = loadState();

  if (state.currentMode !== "auto") {
    if (state.modeExpiresAt && Date.now() > state.modeExpiresAt) {
      return "临时模式已过期，恢复自动";
    }
    return `【硬规则】临时模式：${state.currentMode}`;
  }

  // 触发一次计算
  const result = shouldSendAsVoice(responseText, userMessage);
  const scoreInfo = (globalThis as any).__lastVoiceScore || { score: 0, factors: [] };
  
  const factorStr = scoreInfo.factors.length > 0 ? scoreInfo.factors.join(", ") : "无信号";
  return `【权重计算】${factorStr} → 总分=${scoreInfo.score.toFixed(2)} → ${result ? "语音" : "文本"}`;
}

/**
 * Generate TTS audio file from text
 */
export async function generateTTS(text: string): Promise<{ opusPath: string; durationMs: number }> {
  const config = loadConfig();
  const useZhEn = containsEnglish(text);
  const modelConfig = useZhEn ? config.models["zh-en"] : config.models.zh;
  const modelDir = `${TTS_MODELS_DIR}/${modelConfig.name}`;

  let modelFile = `${modelConfig.name}.onnx`;
  if (!fs.existsSync(`${modelDir}/${modelFile}`)) {
    modelFile = "model.onnx";
  }

  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const wavPath = path.join(tmpDir, `tts_${timestamp}.wav`);
  const opusPath = path.join(tmpDir, `tts_${timestamp}.opus`);

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
  execSync(`ffmpeg -y -i "${wavPath}" -acodec libopus -ac 1 -ar 16000 "${opusPath}"`, { stdio: "pipe" });

  const durationStr = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${opusPath}"`,
  ).toString().trim();
  const durationMs = Math.round(parseFloat(durationStr) * 1000);

  fs.unlinkSync(wavPath);
  return { opusPath, durationMs };
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
  const { opusPath, durationMs } = await generateTTS(text);

  try {
    const { fileKey } = await uploadFileFeishu({
      cfg,
      file: opusPath,
      fileName: "voice.opus",
      fileType: "opus",
      duration: durationMs,
    });

    return await sendAudioFeishu({ cfg, to, fileKey, replyToMessageId });
  } finally {
    if (fs.existsSync(opusPath)) {
      fs.unlinkSync(opusPath);
    }
  }
}

/**
 * Check if TTS is available
 */
export function isTTSAvailable(): boolean {
  const config = loadConfig();
  try {
    return (
      fs.existsSync(TTS_RUNTIME) &&
      fs.existsSync(`${TTS_MODELS_DIR}/${config.models.zh.name}`) &&
      fs.existsSync(`${TTS_MODELS_DIR}/${config.models["zh-en"].name}`)
    );
  } catch {
    return false;
  }
}

/**
 * Get current config and state (for debugging)
 */
export function getDebugInfo() {
  return {
    config: loadConfig(),
    state: loadState(),
    ttsAvailable: isTTSAvailable(),
  };
}
