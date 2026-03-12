import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  resolveFeishuAccount: vi.fn(),
  createFeishuClient: vi.fn(),
  getFeishuRuntime: vi.fn(),
  normalizeFeishuTarget: vi.fn((target: string) => target),
  resolveReceiveIdType: vi.fn(() => "chat_id"),
  parseFeishuMediaDurationMs: vi.fn(),
  createReadStream: vi.fn(),
}));

vi.mock("../accounts.js", () => ({
  resolveFeishuAccount: mocked.resolveFeishuAccount,
}));

vi.mock("../client.js", () => ({
  createFeishuClient: mocked.createFeishuClient,
}));

vi.mock("../runtime.js", () => ({
  getFeishuRuntime: mocked.getFeishuRuntime,
}));

vi.mock("../targets.js", () => ({
  normalizeFeishuTarget: mocked.normalizeFeishuTarget,
  resolveReceiveIdType: mocked.resolveReceiveIdType,
}));

vi.mock("../media-duration.js", () => ({
  parseFeishuMediaDurationMs: mocked.parseFeishuMediaDurationMs,
}));

import {
  detectFileType,
  sendAudioFeishu,
  sendMediaFeishu,
} from "../media.js";

function setupMediaModule() {
  const client = {
    im: {
      image: {
        create: vi.fn().mockResolvedValue({ data: { image_key: "img_123" } }),
      },
      file: {
        create: vi.fn().mockResolvedValue({ data: { file_key: "file_123" } }),
      },
      message: {
        create: vi.fn().mockResolvedValue({ code: 0, data: { message_id: "om_created" } }),
        reply: vi.fn().mockResolvedValue({ code: 0, data: { message_id: "om_reply" } }),
      },
    },
  };

  mocked.resolveFeishuAccount.mockReturnValue({
    accountId: "acc",
    configured: true,
    config: {
      mediaMaxMb: 30,
      mediaLocalRoots: [],
    },
  });
  mocked.createFeishuClient.mockReturnValue(client);
  mocked.getFeishuRuntime.mockReturnValue({
    media: {
      loadWebMedia: vi.fn(),
    },
  });
  mocked.parseFeishuMediaDurationMs.mockReturnValue(undefined);

  return { client };
}

describe("media", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects file types from extension", () => {
    expect(detectFileType("voice.mp3")).toBe("opus");
    expect(detectFileType("video.mov")).toBe("mp4");
    expect(detectFileType("slides.pptx")).toBe("ppt");
    expect(detectFileType("file.unknown")).toBe("stream");
  });

  it("sends audio replies with duration", async () => {
    const { client } = setupMediaModule();

    const result = await sendAudioFeishu({
      cfg: {} as any,
      to: "oc_123",
      fileKey: "file_123",
      replyToMessageId: "om_parent",
      durationMs: 1234,
    });

    expect(client.im.message.reply).toHaveBeenCalledWith({
      path: { message_id: "om_parent" },
      data: {
        content: JSON.stringify({ file_key: "file_123", duration: 1234 }),
        msg_type: "audio",
      },
    });
    expect(result).toEqual({ messageId: "om_reply", chatId: "oc_123" });
  });

  it("sends image media from buffers through uploadImageFeishu path", async () => {
    const { client } = setupMediaModule();

    const result = await sendMediaFeishu({
      cfg: {} as any,
      to: "oc_123",
      mediaBuffer: Buffer.from("fake"),
      fileName: "picture.png",
    });

    expect(client.im.image.create).toHaveBeenCalled();
    expect(client.im.message.create).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_123",
        content: JSON.stringify({ image_key: "img_123" }),
        msg_type: "image",
      },
    });
    expect(result).toEqual({ messageId: "om_created", chatId: "oc_123" });
  });

  it("sends audio files from buffers through uploadFileFeishu path", async () => {
    const { client } = setupMediaModule();

    const result = await sendMediaFeishu({
      cfg: {} as any,
      to: "oc_123",
      mediaBuffer: Buffer.from("fake-audio"),
      fileName: "voice.mp3",
    });

    expect(client.im.file.create).toHaveBeenCalledWith({
      data: {
        file_type: "opus",
        file_name: "voice.mp3",
        file: expect.anything(),
      },
    });
    expect(client.im.message.create).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_123",
        content: JSON.stringify({ file_key: "file_123" }),
        msg_type: "audio",
      },
    });
    expect(result).toEqual({ messageId: "om_created", chatId: "oc_123" });
  });

  it("rejects invalid targets", async () => {
    setupMediaModule();
    mocked.normalizeFeishuTarget.mockReturnValueOnce(null);

    await expect(
      sendAudioFeishu({
        cfg: {} as any,
        to: "bad-target",
        fileKey: "file_123",
      }),
    ).rejects.toThrow("Invalid Feishu target: bad-target");
  });
});
