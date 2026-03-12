import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { sendAudioFeishu, type SendMediaResult, uploadFileFeishu } from "./media.js";

const SKILL_DIR = `${os.homedir()}/.openclaw/workspace/skills/feishu-voice`;
const SKILL_CONFIG_PATH = `${SKILL_DIR}/skill.json`;
const STATE_PATH = `${SKILL_DIR}/state.json`;

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

const DEFAULT_WEIGHTS = {
  contextKeyword: 0.6,
  userInputMode: 0.3,
  schedule: 0.2,
  longInterval: 0.15,
  learned: 0.25,
};

type CommandSpec = {
  command: string;
  args?: string[];
  display: string;
};

type TTSAvailability = {
  available: boolean;
  missing: string[];
  ttsCommand?: string;
  ffmpegCommand?: string;
  ffprobeCommand?: string;
};

const AVAILABILITY_CACHE_TTL_MS = 30_000;

const EDGE_TTS_CANDIDATES: CommandSpec[] = [
  { command: "edge-tts", display: "edge-tts" },
  { command: "python", args: ["-m", "edge_tts"], display: "python -m edge_tts" },
  { command: "py", args: ["-m", "edge_tts"], display: "py -m edge_tts" },
];

const FFMPEG_CANDIDATES: CommandSpec[] = [{ command: "ffmpeg", display: "ffmpeg" }];
const FFPROBE_CANDIDATES: CommandSpec[] = [{ command: "ffprobe", display: "ffprobe" }];

let cachedAvailability:
  | {
      value: TTSAvailability;
      expiresAt: number;
    }
  | null = null;

function tryResolveCommand(candidates: CommandSpec[], probeArgs: string[]): CommandSpec | undefined {
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...(candidate.args ?? []), ...probeArgs], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0) {
      return candidate;
    }
  }
  return undefined;
}

function runCommand(spec: CommandSpec, args: string[], purpose: string): string {
  const result = spawnSync(spec.command, [...(spec.args ?? []), ...args], {
    encoding: "utf-8",
    stdio: "pipe",
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim();
    throw new Error(`${purpose} failed via "${spec.display}"${details ? `: ${details}` : ""}`);
  }

  return result.stdout ?? "";
}

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
  } catch (error) {
    console.error("Failed to load skill config:", error);
  }
  return DEFAULT_CONFIG;
}

function loadState(): VoiceState {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const raw = fs.readFileSync(STATE_PATH, "utf-8");
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    }
  } catch (error) {
    console.error("Failed to load state:", error);
  }
  return DEFAULT_STATE;
}

function saveState(state: VoiceState): void {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error("Failed to save state:", error);
  }
}

export function updateInteraction(userInputMode?: "voice" | "text"): void {
  const state = loadState();
  state.lastInteractionAt = Date.now();
  if (userInputMode) {
    state.lastUserInputMode = userInputMode;
  }
  saveState(state);
}

export function setTemporaryMode(mode: "voice" | "text" | "auto", durationMs?: number): void {
  const state = loadState();
  state.currentMode = mode;
  state.modeSetAt = Date.now();
  state.modeExpiresAt = durationMs ? Date.now() + durationMs : null;
  saveState(state);
}

export function recordCorrection(correctedTo: "voice" | "text"): void {
  const state = loadState();
  const now = new Date();
  state.corrections.push({
    timestamp: Date.now(),
    dayOfWeek: now.getDay(),
    hour: now.getHours(),
    correctedTo,
  });
  if (state.corrections.length > 50) {
    state.corrections = state.corrections.slice(-50);
  }
  saveState(state);
}

function parseTime(timeStr: string): number {
  const [hour, minute] = timeStr.split(":").map(Number);
  return hour * 60 + minute;
}

export function mustUseText(text: string): boolean {
  const config = loadConfig();
  const rules = config.rules.forceText;

  if (rules.codeBlocks && /```[\s\S]*```/.test(text)) return true;
  if (rules.codeBlocks && (text.match(/`[^`]+`/g) || []).length > 2) return true;
  if (rules.tables && /\|.*\|.*\|/.test(text)) return true;
  if (text.length > rules.maxChars) return true;
  if (rules.techKeywords) {
    const techKeywords =
      /\b(function|const|let|var|import|export|class|interface|type|async|await|return|if|else|for|while|npm|git|docker|api|http|json|xml|sql|bash|shell|python|javascript|typescript|node|react|vue)\b/i;
    if (techKeywords.test(text)) return true;
  }
  return false;
}

export function detectContextFromMessage(userMessage: string): "voice" | "text" | null {
  const config = loadConfig();
  for (const keyword of config.rules.contextKeywords.voice) {
    if (userMessage.includes(keyword)) return "voice";
  }
  for (const keyword of config.rules.contextKeywords.text) {
    if (userMessage.includes(keyword)) return "text";
  }
  return null;
}

function getSchedulePreference(): "voice" | "text" {
  const schedule = loadConfig().rules.schedule;
  const now = new Date();
  const shanghaiTime = new Date(now.toLocaleString("en-US", { timeZone: schedule.timezone }));
  const day = shanghaiTime.getDay();
  const currentTime = shanghaiTime.getHours() * 60 + shanghaiTime.getMinutes();

  if (day === 0 || day === 6) {
    return schedule.weekend;
  }

  for (const [timeRange, mode] of Object.entries(schedule.weekday)) {
    const [startStr, endStr] = timeRange.split("-");
    const start = parseTime(startStr);
    const end = parseTime(endStr);
    if (start > end) {
      if (currentTime >= start || currentTime < end) return mode;
    } else if (currentTime >= start && currentTime < end) {
      return mode;
    }
  }

  return "voice";
}

function getLearnedPreference(): "voice" | "text" | null {
  const state = loadState();
  if (state.corrections.length < 3) return null;

  const now = new Date();
  const currentDay = now.getDay();
  const currentHour = now.getHours();
  const relevantCorrections = state.corrections.filter(
    (item) => item.dayOfWeek === currentDay && Math.abs(item.hour - currentHour) <= 2,
  );

  if (relevantCorrections.length < 2) return null;

  const recent = relevantCorrections.slice(-3);
  const voiceCount = recent.filter((item) => item.correctedTo === "voice").length;
  if (voiceCount >= 2) return "voice";
  if (voiceCount === 0) return "text";
  return null;
}

function loadWeights(): typeof DEFAULT_WEIGHTS {
  try {
    if (fs.existsSync(SKILL_CONFIG_PATH)) {
      const raw = fs.readFileSync(SKILL_CONFIG_PATH, "utf-8");
      const json = JSON.parse(raw);
      return { ...DEFAULT_WEIGHTS, ...json.config?.weights };
    }
  } catch (error) {
    console.error("Failed to load weights:", error);
  }
  return DEFAULT_WEIGHTS;
}

export function getTTSAvailability(forceRefresh = false): TTSAvailability {
  const now = Date.now();
  if (!forceRefresh && cachedAvailability && cachedAvailability.expiresAt > now) {
    return cachedAvailability.value;
  }

  const tts = tryResolveCommand(EDGE_TTS_CANDIDATES, ["--help"]);
  const ffmpeg = tryResolveCommand(FFMPEG_CANDIDATES, ["-version"]);
  const ffprobe = tryResolveCommand(FFPROBE_CANDIDATES, ["-version"]);

  const value: TTSAvailability = {
    available: Boolean(tts && ffmpeg && ffprobe),
    missing: [
      ...(tts ? [] : ["edge-tts (or python -m edge_tts / py -m edge_tts)"]),
      ...(ffmpeg ? [] : ["ffmpeg"]),
      ...(ffprobe ? [] : ["ffprobe"]),
    ],
    ttsCommand: tts?.display,
    ffmpegCommand: ffmpeg?.display,
    ffprobeCommand: ffprobe?.display,
  };

  cachedAvailability = {
    value,
    expiresAt: now + AVAILABILITY_CACHE_TTL_MS,
  };

  return value;
}

export function getTTSUnavailableReason(): string | undefined {
  const availability = getTTSAvailability();
  if (availability.available) return undefined;
  return `TTS unavailable: missing ${availability.missing.join(", ")}`;
}

export function shouldSendAsVoice(responseText: string, userMessage?: string): boolean {
  if (mustUseText(responseText)) {
    return false;
  }

  const state = loadState();
  const config = loadConfig();

  if (state.currentMode !== "auto") {
    if (state.modeExpiresAt && Date.now() > state.modeExpiresAt) {
      setTemporaryMode("auto");
    } else {
      return state.currentMode === "voice";
    }
  }

  const weights = loadWeights();
  let score = 0;
  const factors: string[] = [];

  if (userMessage) {
    const contextMode = detectContextFromMessage(userMessage);
    if (contextMode === "voice") {
      score += weights.contextKeyword;
      factors.push(`情境关键词:+${weights.contextKeyword}`);
    } else if (contextMode === "text") {
      score -= weights.contextKeyword;
      factors.push(`情境关键词:-${weights.contextKeyword}`);
    }
  }

  if (config.rules.adaptiveRules.followUserInputMode && state.lastUserInputMode) {
    if (state.lastUserInputMode === "voice") {
      score += weights.userInputMode;
      factors.push(`用户输入:+${weights.userInputMode}`);
    } else {
      score -= weights.userInputMode;
      factors.push(`用户输入:-${weights.userInputMode}`);
    }
  }

  const schedulePreference = getSchedulePreference();
  if (schedulePreference === "voice") {
    score += weights.schedule;
    factors.push(`时间表:+${weights.schedule}`);
  } else {
    score -= weights.schedule;
    factors.push(`时间表:-${weights.schedule}`);
  }

  if (state.lastInteractionAt) {
    const interval = Date.now() - state.lastInteractionAt;
    if (interval > config.rules.adaptiveRules.longIntervalThresholdMs) {
      if (config.rules.adaptiveRules.longIntervalPreference === "voice") {
        score += weights.longInterval;
        factors.push(`长间隔:+${weights.longInterval}`);
      } else {
        score -= weights.longInterval;
        factors.push(`长间隔:-${weights.longInterval}`);
      }
    }
  }

  const learned = getLearnedPreference();
  if (learned === "voice") {
    score += weights.learned;
    factors.push(`学习记录:+${weights.learned}`);
  } else if (learned === "text") {
    score -= weights.learned;
    factors.push(`学习记录:-${weights.learned}`);
  }

  (globalThis as { __lastVoiceScore?: { score: number; factors: string[] } }).__lastVoiceScore = {
    score,
    factors,
  };

  return score > 0;
}

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

  const result = shouldSendAsVoice(responseText, userMessage);
  const scoreInfo =
    (globalThis as { __lastVoiceScore?: { score: number; factors: string[] } }).__lastVoiceScore ??
    { score: 0, factors: [] };
  const factorStr = scoreInfo.factors.length > 0 ? scoreInfo.factors.join(", ") : "无信号";
  return `【权重计算】${factorStr} → 总分=${scoreInfo.score.toFixed(2)} → ${result ? "语音" : "文本"}`;
}

export async function generateTTS(text: string): Promise<{ opusPath: string; durationMs: number }> {
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const textPath = path.join(tmpDir, `tts_${timestamp}.txt`);
  const mp3Path = path.join(tmpDir, `tts_${timestamp}.mp3`);
  const opusPath = path.join(tmpDir, `tts_${timestamp}.opus`);
  const availability = getTTSAvailability();

  fs.writeFileSync(textPath, text, "utf-8");

  try {
    const ttsCommand = tryResolveCommand(EDGE_TTS_CANDIDATES, ["--help"]);
    const ffmpegCommand = tryResolveCommand(FFMPEG_CANDIDATES, ["-version"]);
    const ffprobeCommand = tryResolveCommand(FFPROBE_CANDIDATES, ["-version"]);
    if (!ttsCommand || !ffmpegCommand || !ffprobeCommand) {
      throw new Error(
        `Cannot generate TTS audio. Missing dependencies: ${availability.missing.join(", ")}`,
      );
    }

    const voice = "zh-CN-XiaoxiaoNeural";
    runCommand(
      ttsCommand,
      ["--file", textPath, "--voice", voice, "--write-media", mp3Path],
      "edge TTS synthesis",
    );
    runCommand(
      ffmpegCommand,
      ["-y", "-i", mp3Path, "-af", "volume=12dB", "-acodec", "libopus", "-ac", "1", "-ar", "16000", opusPath],
      "ffmpeg Opus conversion",
    );
    const durationStr = runCommand(
      ffprobeCommand,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", opusPath],
      "ffprobe duration probe",
    ).trim();
    const durationSec = Number.parseFloat(durationStr);
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error(
        `ffprobe returned an invalid duration for generated audio: ${durationStr || "<empty>"}`,
      );
    }
    const durationMs = Math.round(durationSec * 1000);
    return { opusPath, durationMs };
  } finally {
    if (fs.existsSync(textPath)) fs.unlinkSync(textPath);
    if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
  }
}

export async function sendVoiceMessage(params: {
  cfg: ClawdbotConfig;
  to: string;
  text: string;
  replyToMessageId?: string;
  accountId?: string;
}): Promise<SendMediaResult> {
  const { cfg, to, text, replyToMessageId, accountId } = params;
  const { opusPath, durationMs } = await generateTTS(text);

  try {
    const { fileKey } = await uploadFileFeishu({
      cfg,
      file: opusPath,
      fileName: "voice.opus",
      fileType: "opus",
      duration: durationMs,
      accountId,
    });

    return await sendAudioFeishu({
      cfg,
      to,
      fileKey,
      replyToMessageId,
      accountId,
      durationMs,
    });
  } finally {
    if (fs.existsSync(opusPath)) {
      fs.unlinkSync(opusPath);
    }
  }
}

export function isTTSAvailable(): boolean {
  return getTTSAvailability().available;
}

export function getDebugInfo() {
  return {
    config: loadConfig(),
    state: loadState(),
    ttsAvailable: isTTSAvailable(),
    availability: getTTSAvailability(),
  };
}
