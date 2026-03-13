import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempHomes: string[] = [];

async function loadTtsModule(options?: {
  spawnSyncImpl?: (command: string, args: string[]) => { status: number; stdout?: string; stderr?: string };
  mediaModule?: {
    uploadFileFeishu?: ReturnType<typeof vi.fn>;
    sendAudioFeishu?: ReturnType<typeof vi.fn>;
  };
}) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "clawdbot-feishu-tts-"));
  tempHomes.push(tempHome);

  vi.resetModules();
  vi.doMock("os", async () => {
    const actual = await vi.importActual<any>("os");
    return {
      ...actual,
      default: {
        ...actual,
        homedir: () => tempHome,
      },
      homedir: () => tempHome,
    };
  });
  vi.doMock("child_process", () => ({
    spawnSync: vi.fn((command: string, args: string[]) =>
      options?.spawnSyncImpl?.(command, args) ?? { status: 0, stdout: "", stderr: "" },
    ),
  }));
  vi.doMock("../media.js", () => ({
    uploadFileFeishu:
      options?.mediaModule?.uploadFileFeishu ??
      vi.fn().mockResolvedValue({
        fileKey: "file_123",
      }),
    sendAudioFeishu:
      options?.mediaModule?.sendAudioFeishu ??
      vi.fn().mockResolvedValue({
        messageId: "om_123",
        chatId: "oc_123",
      }),
  }));

  const mod = await import("../tts.js");
  return { mod, tempHome };
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.unmock("os");
  vi.unmock("child_process");
  vi.unmock("../media.js");
  for (const tempHome of tempHomes.splice(0)) {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

describe("tts", () => {
  it("detects content that must stay as text", async () => {
    const { mod } = await loadTtsModule();

    expect(mod.mustUseText("```ts\nconst x = 1;\n```")).toBe(true);
    expect(mod.mustUseText("| a | b |\n| - | - |")).toBe(true);
    expect(mod.mustUseText("docker compose logs")).toBe(true);
    expect(mod.mustUseText("short plain sentence")).toBe(false);
  }, 15000);

  it("detects context keywords from user messages", async () => {
    const { mod } = await loadTtsModule();

    expect(mod.detectContextFromMessage("我在路上")).toBe("voice");
    expect(mod.detectContextFromMessage("我到公司了")).toBe("text");
    expect(mod.detectContextFromMessage("普通消息")).toBeNull();
  });

  it("respects temporary mode overrides", async () => {
    const { mod } = await loadTtsModule();

    mod.setTemporaryMode("text", 60_000);
    expect(mod.shouldSendAsVoice("短回复", "在路上")).toBe(false);
    expect(mod.explainDecision("短回复", "在路上")).toContain("临时模式：text");

    mod.setTemporaryMode("voice", 60_000);
    expect(mod.shouldSendAsVoice("短回复", "到公司了")).toBe(true);
    expect(mod.explainDecision("短回复", "到公司了")).toContain("临时模式：voice");
  });

  it("returns debug information including temporary mode state", async () => {
    const { mod } = await loadTtsModule();

    mod.setTemporaryMode("text", 120_000);
    const debug = mod.getDebugInfo();

    expect(debug.state.currentMode).toBe("text");
    expect(typeof debug.state.modeSetAt).toBe("number");
    expect(debug.ttsAvailable).toBe(true);
  });

  it("reports missing TTS dependencies", async () => {
    const { mod } = await loadTtsModule({
      spawnSyncImpl: (command) => {
        if (command === "ffmpeg" || command === "ffprobe") {
          return { status: 0, stdout: "", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "missing" };
      },
    });

    const availability = mod.getTTSAvailability(true);
    expect(availability.available).toBe(false);
    expect(availability.missing).toContain("edge-tts (or python -m edge_tts / py -m edge_tts)");
    expect(mod.getTTSUnavailableReason()).toContain("edge-tts");
  });

  it("returns no unavailable reason when dependencies are present", async () => {
    const { mod } = await loadTtsModule();
    expect(mod.getTTSUnavailableReason()).toBeUndefined();
  });

  it("generates TTS output duration from ffprobe", async () => {
    const { mod } = await loadTtsModule({
      spawnSyncImpl: (command) => {
        if (command === "ffprobe") {
          return { status: 0, stdout: "1.5\n" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    const result = await mod.generateTTS("hello");
    expect(result.durationMs).toBe(1500);
    expect(result.opusPath.endsWith(".opus")).toBe(true);
  });

  it("sends voice messages via upload and audio send helpers", async () => {
    const uploadFileFeishu = vi.fn().mockResolvedValue({ fileKey: "file_456" });
    const sendAudioFeishu = vi.fn().mockResolvedValue({ messageId: "om_456", chatId: "oc_456" });
    const { mod } = await loadTtsModule({
      spawnSyncImpl: (command) => {
        if (command === "ffprobe") {
          return { status: 0, stdout: "2.0\n" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      mediaModule: {
        uploadFileFeishu,
        sendAudioFeishu,
      },
    });

    const result = await mod.sendVoiceMessage({
      cfg: {} as any,
      to: "oc_456",
      text: "hello",
      replyToMessageId: "om_parent",
      accountId: "acc",
    });

    expect(uploadFileFeishu).toHaveBeenCalledWith({
      cfg: {},
      file: expect.stringMatching(/\.opus$/),
      fileName: "voice.opus",
      fileType: "opus",
      duration: 2000,
      accountId: "acc",
    });
    expect(sendAudioFeishu).toHaveBeenCalledWith({
      cfg: {},
      to: "oc_456",
      fileKey: "file_456",
      replyToMessageId: "om_parent",
      accountId: "acc",
      durationMs: 2000,
    });
    expect(result).toEqual({ messageId: "om_456", chatId: "oc_456" });
  });

  it("updates interaction state and records corrections", async () => {
    const { mod, tempHome } = await loadTtsModule();
    const statePath = path.join(tempHome, ".openclaw/workspace/skills/feishu-voice/state.json");

    mod.updateInteraction("voice");
    mod.recordCorrection("text");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));

    expect(state.lastUserInputMode).toBe("voice");
    expect(state.lastInteractionAt).toBeTypeOf("number");
    expect(state.corrections).toHaveLength(1);
    expect(state.corrections[0].correctedTo).toBe("text");
  });

  it("trims correction history to the latest 50 entries", async () => {
    const { mod, tempHome } = await loadTtsModule();
    const statePath = path.join(tempHome, ".openclaw/workspace/skills/feishu-voice/state.json");
    const now = new Date();
    const corrections = Array.from({ length: 51 }, (_item, index) => ({
      timestamp: Date.now() + index,
      dayOfWeek: now.getDay(),
      hour: now.getHours(),
      correctedTo: "voice" as const,
    }));
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        currentMode: "auto",
        modeSetAt: null,
        modeExpiresAt: null,
        lastUserInputMode: null,
        lastInteractionAt: null,
        corrections,
      }),
    );

    mod.recordCorrection("text");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    expect(state.corrections).toHaveLength(50);
    expect(state.corrections.at(-1).correctedTo).toBe("text");
  });

  it("expires temporary mode and falls back to automatic scoring", async () => {
    const { mod } = await loadTtsModule();

    mod.setTemporaryMode("voice", -1);
    expect(mod.shouldSendAsVoice("短回复", "到公司了")).toBeTypeOf("boolean");
    expect(mod.getDebugInfo().state.currentMode).toBe("auto");
  });

  it("uses weekend schedule preference when configured", async () => {
    const { mod, tempHome } = await loadTtsModule();
    const skillPath = path.join(tempHome, ".openclaw/workspace/skills/feishu-voice/skill.json");
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(
      skillPath,
      JSON.stringify({
        config: {
          rules: {
            schedule: {
              timezone: "Asia/Shanghai",
              weekend: "text",
            },
          },
        },
      }),
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T04:00:00.000Z"));

    expect(mod.shouldSendAsVoice("短回复", "普通消息")).toBe(false);
    expect(mod.explainDecision("短回复", "普通消息")).toContain("时间表:-");
  });

  it("uses positive context and schedule signals when configured", async () => {
    const { mod, tempHome } = await loadTtsModule();
    const skillPath = path.join(tempHome, ".openclaw/workspace/skills/feishu-voice/skill.json");
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(
      skillPath,
      JSON.stringify({
        config: {
          rules: {
            schedule: {
              timezone: "Asia/Shanghai",
              weekday: {
                "00:00-23:59": "voice",
              },
              weekend: "voice",
            },
            adaptiveRules: {
              followUserInputMode: false,
              longIntervalThresholdMs: 999999999,
            },
          },
          weights: {
            userInputMode: 0,
            learned: 0,
            longInterval: 0,
          },
        },
      }),
    );

    expect(mod.shouldSendAsVoice("短回复", "我在路上")).toBe(true);
    expect(mod.explainDecision("短回复", "我在路上")).toContain("情境关键词:+");
    expect(mod.explainDecision("短回复", "我在路上")).toContain("时间表:+");
  });

  it("uses overnight weekday schedule windows", async () => {
    const { mod, tempHome } = await loadTtsModule();
    const skillPath = path.join(tempHome, ".openclaw/workspace/skills/feishu-voice/skill.json");
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(
      skillPath,
      JSON.stringify({
        config: {
          rules: {
            schedule: {
              timezone: "Asia/Shanghai",
              weekday: {
                "19:00-07:00": "text",
              },
              weekend: "voice",
            },
            adaptiveRules: {
              followUserInputMode: false,
              longIntervalThresholdMs: 999999999,
            },
          },
          weights: {
            contextKeyword: 0,
            userInputMode: 0,
            learned: 0,
          },
        },
      }),
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T13:30:00.000Z"));

    expect(mod.shouldSendAsVoice("短回复", "普通消息")).toBe(false);
    expect(mod.explainDecision("短回复", "普通消息")).toContain("时间表:-");
  });

  it("prefers learned text mode after repeated corrections", async () => {
    const { mod, tempHome } = await loadTtsModule();
    const statePath = path.join(tempHome, ".openclaw/workspace/skills/feishu-voice/state.json");
    const now = new Date();
    const state = {
      currentMode: "auto",
      modeSetAt: null,
      modeExpiresAt: null,
      lastUserInputMode: "text",
      lastInteractionAt: Date.now(),
      corrections: [
        {
          timestamp: Date.now(),
          dayOfWeek: now.getDay(),
          hour: now.getHours(),
          correctedTo: "text",
        },
        {
          timestamp: Date.now(),
          dayOfWeek: now.getDay(),
          hour: now.getHours(),
          correctedTo: "text",
        },
        {
          timestamp: Date.now(),
          dayOfWeek: now.getDay(),
          hour: now.getHours(),
          correctedTo: "text",
        },
      ],
    };
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state));

    expect(mod.shouldSendAsVoice("短回复", "普通消息")).toBe(false);
    expect(mod.explainDecision("短回复", "普通消息")).toContain("学习记录");
  });

  it("prefers learned voice mode after repeated voice corrections", async () => {
    const { mod, tempHome } = await loadTtsModule();
    const statePath = path.join(tempHome, ".openclaw/workspace/skills/feishu-voice/state.json");
    const now = new Date();
    const state = {
      currentMode: "auto",
      modeSetAt: null,
      modeExpiresAt: null,
      lastUserInputMode: "voice",
      lastInteractionAt: Date.now() - 600_000,
      corrections: [
        {
          timestamp: Date.now(),
          dayOfWeek: now.getDay(),
          hour: now.getHours(),
          correctedTo: "voice",
        },
        {
          timestamp: Date.now(),
          dayOfWeek: now.getDay(),
          hour: now.getHours(),
          correctedTo: "voice",
        },
        {
          timestamp: Date.now(),
          dayOfWeek: now.getDay(),
          hour: now.getHours(),
          correctedTo: "voice",
        },
      ],
    };
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state));

    expect(mod.shouldSendAsVoice("短回复", "普通消息")).toBe(true);
    expect(mod.explainDecision("短回复", "普通消息")).toContain("学习记录");
  });

  it("applies long interval text preference when configured", async () => {
    const { mod, tempHome } = await loadTtsModule();
    const skillPath = path.join(tempHome, ".openclaw/workspace/skills/feishu-voice/skill.json");
    const statePath = path.join(tempHome, ".openclaw/workspace/skills/feishu-voice/state.json");
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(
      skillPath,
      JSON.stringify({
        config: {
          rules: {
            adaptiveRules: {
              longIntervalThresholdMs: 1,
              longIntervalPreference: "text",
              followUserInputMode: false,
            },
          },
          weights: {
            contextKeyword: 0,
            userInputMode: 0,
            schedule: 0,
            learned: 0,
            longInterval: 1,
          },
        },
      }),
    );
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        currentMode: "auto",
        modeSetAt: null,
        modeExpiresAt: null,
        lastUserInputMode: null,
        lastInteractionAt: Date.now() - 10_000,
        corrections: [],
      }),
    );

    expect(mod.shouldSendAsVoice("短回复", "普通消息")).toBe(false);
    expect(mod.explainDecision("短回复", "普通消息")).toContain("长间隔:-");
  });

  it("returns false when text hard rules force text output", async () => {
    const { mod } = await loadTtsModule();
    expect(mod.shouldSendAsVoice("```ts\nconst x = 1\n```", "在路上")).toBe(false);
    expect(mod.explainDecision("```ts\nconst x = 1\n```", "在路上")).toContain("强制文本");
  });

  it("reports expired temporary mode in explainDecision", async () => {
    const { mod } = await loadTtsModule();
    mod.setTemporaryMode("text", -1);
    expect(mod.explainDecision("短回复", "普通消息")).toBe("临时模式已过期，恢复自动");
  });

  it("handles config and state load failures gracefully", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "clawdbot-feishu-tts-broken-"));
    tempHomes.push(tempHome);
    const skillDir = path.join(tempHome, ".openclaw/workspace/skills/feishu-voice");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "skill.json"), "{}");
    fs.writeFileSync(path.join(skillDir, "state.json"), "{}");

    vi.resetModules();
    vi.doMock("os", async () => {
      const actual = await vi.importActual<any>("os");
      return {
        ...actual,
        default: {
          ...actual,
          homedir: () => tempHome,
        },
        homedir: () => tempHome,
      };
    });
    vi.doMock("child_process", () => ({
      spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
    }));
    vi.doMock("../media.js", () => ({
      uploadFileFeishu: vi.fn().mockResolvedValue({ fileKey: "file_123" }),
      sendAudioFeishu: vi.fn().mockResolvedValue({ messageId: "om_123", chatId: "oc_123" }),
    }));

    const readFileSpy = vi
      .spyOn(fs, "readFileSync")
      .mockImplementation(() => {
        throw new Error("broken");
      });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("../tts.js");

    expect(mod.getDebugInfo().config.models.zh.name).toBe("vits-zh-hf-fanchen-C");
    expect(errorSpy).toHaveBeenCalled();

    readFileSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("handles saveState failures gracefully", async () => {
    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
      throw new Error("mkdir failed");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { mod } = await loadTtsModule();

    mod.setTemporaryMode("text", 60_000);
    expect(errorSpy).toHaveBeenCalledWith("Failed to save state:", expect.any(Error));

    mkdirSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("reports ffprobe duration errors", async () => {
    const { mod } = await loadTtsModule({
      spawnSyncImpl: (command) => {
        if (command === "ffprobe") {
          return { status: 0, stdout: "NaN\n" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    await expect(mod.generateTTS("hello")).rejects.toThrow(
      "ffprobe returned an invalid duration",
    );
  });

  it("reports missing binary dependencies from generateTTS", async () => {
    const { mod } = await loadTtsModule({
      spawnSyncImpl: (command, args) => {
        const joinedArgs = args.join(" ");
        if (
          (command === "edge-tts" || command === "python" || command === "py") &&
          joinedArgs.includes("--help")
        ) {
          return { status: 1, stdout: "", stderr: "missing" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    await expect(mod.generateTTS("hello")).rejects.toThrow(
      "Cannot generate TTS audio. Missing dependencies",
    );
  });

  it("reports subprocess command failures from generateTTS", async () => {
    const { mod } = await loadTtsModule({
      spawnSyncImpl: (command, args) => {
        const joinedArgs = args.join(" ");
        if (command === "ffmpeg" && joinedArgs.includes("-version")) {
          return { status: 0, stdout: "", stderr: "" };
        }
        if (command === "ffmpeg") {
          return { status: 1, stdout: "", stderr: "ffmpeg failed" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    await expect(mod.generateTTS("hello")).rejects.toThrow(
      'ffmpeg Opus conversion failed via "ffmpeg": ffmpeg failed',
    );
  });

  it("cleans up generated opus file after sendVoiceMessage", async () => {
    const uploadFileFeishu = vi.fn().mockResolvedValue({ fileKey: "file_789" });
    const sendAudioFeishu = vi.fn().mockResolvedValue({ messageId: "om_789", chatId: "oc_789" });
    const { mod } = await loadTtsModule({
      spawnSyncImpl: (command, args) => {
        if (command === "ffmpeg") {
          const opusPath = args[args.length - 1];
          fs.writeFileSync(opusPath, Buffer.from("opus"));
          return { status: 0, stdout: "", stderr: "" };
        }
        if (command === "ffprobe") {
          return { status: 0, stdout: "1.0\n" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      mediaModule: {
        uploadFileFeishu,
        sendAudioFeishu,
      },
    });

    const unlinkSpy = vi.spyOn(fs, "unlinkSync");
    await mod.sendVoiceMessage({
      cfg: {} as any,
      to: "oc_789",
      text: "hello",
    });
    expect(
      unlinkSpy.mock.calls.some(([targetPath]) => typeof targetPath === "string" && /\.opus$/.test(targetPath)),
    ).toBe(true);
    unlinkSpy.mockRestore();
  });

  it("exposes availability through isTTSAvailable", async () => {
    const { mod } = await loadTtsModule({
      spawnSyncImpl: (_command) => ({ status: 1, stdout: "", stderr: "" }),
    });
    expect(mod.isTTSAvailable()).toBe(false);
  });
});
