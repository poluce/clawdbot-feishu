import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempHomes: string[] = [];

async function loadTtsModule(options?: {
  spawnSyncImpl?: (command: string, args: string[]) => { status: number; stdout?: string; stderr?: string };
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

  const mod = await import("../tts.js");
  return { mod, tempHome };
}

afterEach(() => {
  vi.resetModules();
  vi.unmock("os");
  vi.unmock("child_process");
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
  });

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
});
