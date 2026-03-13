import fs from "node:fs";
import { Readable } from "node:stream";
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
  downloadImageFeishu,
  downloadMessageResourceFeishu,
  detectFileType,
  sendFileFeishu,
  sendImageFeishu,
  sendAudioFeishu,
  sendMediaFeishu,
  uploadFileFeishu,
  uploadImageFeishu,
} from "../media.js";

function setupMediaModule() {
  const client = {
    im: {
      image: {
        get: vi.fn(),
        create: vi.fn().mockResolvedValue({ data: { image_key: "img_123" } }),
      },
      file: {
        create: vi.fn().mockResolvedValue({ data: { file_key: "file_123" } }),
      },
      messageResource: {
        get: vi.fn(),
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
    expect(detectFileType("sheet.xlsx")).toBe("xls");
    expect(detectFileType("doc.docx")).toBe("doc");
    expect(detectFileType("file.pdf")).toBe("pdf");
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

  it("sends direct audio messages without reply target", async () => {
    const { client } = setupMediaModule();

    const result = await sendAudioFeishu({
      cfg: {} as any,
      to: "oc_123",
      fileKey: "file_123",
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

  it("uploads image and file buffers", async () => {
    const { client } = setupMediaModule();

    await expect(uploadImageFeishu({ cfg: {} as any, image: Buffer.from("img") })).resolves.toEqual({
      imageKey: "img_123",
    });
    await expect(
      uploadFileFeishu({
        cfg: {} as any,
        file: Buffer.from("file"),
        fileName: "voice.mp3",
        fileType: "opus",
        duration: 1234,
      }),
    ).resolves.toEqual({ fileKey: "file_123" });

    expect(client.im.file.create).toHaveBeenCalledWith({
      data: {
        file_type: "opus",
        file_name: "voice.mp3",
        file: expect.anything(),
        duration: 1234,
      },
    });
  });

  it("throws when upload succeeds without keys", async () => {
    const { client } = setupMediaModule();
    client.im.image.create.mockResolvedValueOnce({});
    await expect(uploadImageFeishu({ cfg: {} as any, image: Buffer.from("img") })).rejects.toThrow(
      "Feishu image upload failed: no image_key returned",
    );

    client.im.file.create.mockResolvedValueOnce({});
    await expect(
      uploadFileFeishu({
        cfg: {} as any,
        file: Buffer.from("file"),
        fileName: "voice.mp3",
        fileType: "opus",
      }),
    ).rejects.toThrow("Feishu file upload failed: no file_key returned");
  });

  it("throws when upload endpoints return explicit errors", async () => {
    const { client } = setupMediaModule();
    client.im.image.create.mockResolvedValueOnce({ code: 999, msg: "image failed" });
    await expect(uploadImageFeishu({ cfg: {} as any, image: Buffer.from("img") })).rejects.toThrow(
      "Feishu image upload failed: image failed",
    );

    client.im.file.create.mockResolvedValueOnce({ code: 999, msg: "file failed" });
    await expect(
      uploadFileFeishu({
        cfg: {} as any,
        file: Buffer.from("file"),
        fileName: "voice.mp3",
        fileType: "opus",
      }),
    ).rejects.toThrow("Feishu file upload failed: file failed");
  });

  it("sends direct image and file messages", async () => {
    const { client } = setupMediaModule();

    await sendImageFeishu({
      cfg: {} as any,
      to: "oc_123",
      imageKey: "img_123",
    });
    await sendFileFeishu({
      cfg: {} as any,
      to: "oc_123",
      fileKey: "file_123",
      msgType: "media",
      imageKey: "img_123",
    });

    expect(client.im.message.create).toHaveBeenNthCalledWith(1, {
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_123",
        content: JSON.stringify({ image_key: "img_123" }),
        msg_type: "image",
      },
    });
    expect(client.im.message.create).toHaveBeenNthCalledWith(2, {
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_123",
        content: JSON.stringify({ file_key: "file_123", image_key: "img_123" }),
        msg_type: "media",
      },
    });
  });

  it("sends image and file replies when replyToMessageId is provided", async () => {
    const { client } = setupMediaModule();

    await sendImageFeishu({
      cfg: {} as any,
      to: "oc_123",
      imageKey: "img_123",
      replyToMessageId: "om_parent",
    });
    await sendFileFeishu({
      cfg: {} as any,
      to: "oc_123",
      fileKey: "file_123",
      replyToMessageId: "om_parent",
    });

    expect(client.im.message.reply).toHaveBeenNthCalledWith(1, {
      path: { message_id: "om_parent" },
      data: {
        content: JSON.stringify({ image_key: "img_123" }),
        msg_type: "image",
      },
    });
    expect(client.im.message.reply).toHaveBeenNthCalledWith(2, {
      path: { message_id: "om_parent" },
      data: {
        content: JSON.stringify({ file_key: "file_123" }),
        msg_type: "file",
      },
    });
  });

  it("throws when image/file send endpoints return explicit errors", async () => {
    const { client } = setupMediaModule();
    client.im.message.reply.mockResolvedValueOnce({ code: 999, msg: "image reply failed" });
    await expect(
      sendImageFeishu({
        cfg: {} as any,
        to: "oc_123",
        imageKey: "img_123",
        replyToMessageId: "om_parent",
      }),
    ).rejects.toThrow("Feishu image reply failed: image reply failed");

    client.im.message.create.mockResolvedValueOnce({ code: 999, msg: "file send failed" });
    await expect(
      sendFileFeishu({
        cfg: {} as any,
        to: "oc_123",
        fileKey: "file_123",
      }),
    ).rejects.toThrow("Feishu file send failed: file send failed");

    client.im.message.create.mockResolvedValueOnce({ code: 999, msg: "audio send failed" });
    await expect(
      sendAudioFeishu({
        cfg: {} as any,
        to: "oc_123",
        fileKey: "file_123",
      }),
    ).rejects.toThrow("Feishu audio send failed: audio send failed");
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

  it("loads remote media and picks file type from content type when extension is unknown", async () => {
    const { client } = setupMediaModule();
    const loadWebMedia = vi.fn().mockResolvedValue({
      buffer: Buffer.from("video"),
      fileName: "downloaded",
      contentType: "video/mp4",
    });
    mocked.getFeishuRuntime.mockReturnValue({
      media: {
        loadWebMedia,
      },
    });
    mocked.parseFeishuMediaDurationMs.mockReturnValue(4321);

    const result = await sendMediaFeishu({
      cfg: {} as any,
      to: "oc_123",
      mediaUrl: "https://example.com/file",
    });

    expect(loadWebMedia).toHaveBeenCalled();
    expect(client.im.file.create).toHaveBeenCalledWith({
      data: {
        file_type: "mp4",
        file_name: "downloaded",
        file: expect.anything(),
        duration: 4321,
      },
    });
    expect(result).toEqual({ messageId: "om_created", chatId: "oc_123" });
  });

  it("sends mp4 without duration when parser returns undefined", async () => {
    const { client } = setupMediaModule();
    const loadWebMedia = vi.fn().mockResolvedValue({
      buffer: Buffer.from("video"),
      fileName: "downloaded",
      contentType: "video/mp4",
    });
    mocked.getFeishuRuntime.mockReturnValue({
      media: {
        loadWebMedia,
      },
    });
    mocked.parseFeishuMediaDurationMs.mockReturnValue(undefined);

    await sendMediaFeishu({
      cfg: {} as any,
      to: "oc_123",
      mediaUrl: "https://example.com/video",
    });

    expect(client.im.file.create).toHaveBeenCalledWith({
      data: {
        file_type: "mp4",
        file_name: "downloaded",
        file: expect.anything(),
      },
    });
  });

  it("downloads image and message resources from different response shapes", async () => {
    const { client } = setupMediaModule();
    client.im.image.get.mockResolvedValueOnce(Buffer.from("img"));
    await expect(
      downloadImageFeishu({ cfg: {} as any, imageKey: "img_123" }),
    ).resolves.toEqual({ buffer: Buffer.from("img") });

    client.im.messageResource.get.mockResolvedValueOnce({
      data: Buffer.from("file"),
    });
    await expect(
      downloadMessageResourceFeishu({
        cfg: {} as any,
        messageId: "om_1",
        fileKey: "file_123",
        type: "file",
      }),
    ).resolves.toEqual({ buffer: Buffer.from("file") });
  });

  it("downloads ArrayBuffer, async iterable, and readable response shapes", async () => {
    const { client } = setupMediaModule();
    client.im.image.get.mockResolvedValueOnce(new ArrayBuffer(3));
    await expect(
      downloadImageFeishu({ cfg: {} as any, imageKey: "img_array" }),
    ).resolves.toEqual({ buffer: Buffer.from([0, 0, 0]) });

    client.im.messageResource.get.mockResolvedValueOnce({
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from("async");
      },
    });
    await expect(
      downloadMessageResourceFeishu({
        cfg: {} as any,
        messageId: "om_async",
        fileKey: "file_async",
        type: "file",
      }),
    ).resolves.toEqual({ buffer: Buffer.from("async") });

    client.im.messageResource.get.mockResolvedValueOnce(Readable.from([Buffer.from("stream")]));
    await expect(
      downloadMessageResourceFeishu({
        cfg: {} as any,
        messageId: "om_stream",
        fileKey: "file_stream",
        type: "file",
      }),
    ).resolves.toEqual({ buffer: Buffer.from("stream") });
  });

  it("downloads stream and writeFile response shapes", async () => {
    const { client } = setupMediaModule();
    client.im.image.get.mockResolvedValueOnce({
      getReadableStream: () => Readable.from([Buffer.from("img-stream")]),
    });
    await expect(
      downloadImageFeishu({ cfg: {} as any, imageKey: "img_stream" }),
    ).resolves.toEqual({ buffer: Buffer.from("img-stream") });

    client.im.messageResource.get.mockResolvedValueOnce({
      writeFile: async (tempPath: string) => {
        await fs.promises.writeFile(tempPath, Buffer.from("file-stream"));
      },
    });
    await expect(
      downloadMessageResourceFeishu({
        cfg: {} as any,
        messageId: "om_2",
        fileKey: "file_stream",
        type: "file",
      }),
    ).resolves.toEqual({ buffer: Buffer.from("file-stream") });
  });

  it("throws for explicit download errors and unknown response shapes", async () => {
    const { client } = setupMediaModule();
    client.im.image.get.mockResolvedValueOnce({ code: 999, msg: "download failed" });
    await expect(downloadImageFeishu({ cfg: {} as any, imageKey: "img_123" })).rejects.toThrow(
      "Feishu image download failed: download failed",
    );

    client.im.messageResource.get.mockResolvedValueOnce({ code: 999, msg: "resource failed" });
    await expect(
      downloadMessageResourceFeishu({
        cfg: {} as any,
        messageId: "om_3",
        fileKey: "file_123",
        type: "file",
      }),
    ).rejects.toThrow("Feishu message resource download failed: resource failed");

    client.im.messageResource.get.mockResolvedValueOnce({ strange: true });
    await expect(
      downloadMessageResourceFeishu({
        cfg: {} as any,
        messageId: "om_4",
        fileKey: "file_123",
        type: "file",
      }),
    ).rejects.toThrow("unexpected response format");
  });

  it("rejects invalid inputs and unconfigured accounts", async () => {
    setupMediaModule();
    await expect(
      sendMediaFeishu({
        cfg: {} as any,
        to: "oc_123",
      }),
    ).rejects.toThrow("Either mediaUrl or mediaBuffer must be provided");

    mocked.resolveFeishuAccount.mockReturnValueOnce({
      accountId: "acc",
      configured: false,
      config: {},
    });
    await expect(downloadImageFeishu({ cfg: {} as any, imageKey: "img_123" })).rejects.toThrow(
      'Feishu account "acc" not configured',
    );

    mocked.resolveFeishuAccount.mockReturnValueOnce({
      accountId: "acc",
      configured: false,
      config: {},
    });
    await expect(
      sendFileFeishu({
        cfg: {} as any,
        to: "oc_123",
        fileKey: "file_123",
      }),
    ).rejects.toThrow('Feishu account "acc" not configured');
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

  it("rejects when sendMediaFeishu account is not configured", async () => {
    mocked.resolveFeishuAccount.mockReturnValue({
      accountId: "acc",
      configured: false,
      config: {},
    });

    await expect(
      sendMediaFeishu({
        cfg: {} as any,
        to: "oc_123",
        mediaBuffer: Buffer.from("fake"),
      }),
    ).rejects.toThrow('Feishu account "acc" not configured');
  });

  it("picks opus and mp4 by content type when extension is unknown", async () => {
    const { client } = setupMediaModule();
    const loadWebMedia = vi
      .fn()
      .mockResolvedValueOnce({
        buffer: Buffer.from("audio"),
        fileName: "downloaded",
        contentType: "audio/ogg",
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from("video"),
        fileName: "downloaded",
        contentType: "video/mp4",
      });
    mocked.getFeishuRuntime.mockReturnValue({
      media: {
        loadWebMedia,
      },
    });
    mocked.parseFeishuMediaDurationMs.mockReturnValue(2222);

    await sendMediaFeishu({
      cfg: {} as any,
      to: "oc_123",
      mediaUrl: "https://example.com/audio",
    });
    await sendMediaFeishu({
      cfg: {} as any,
      to: "oc_123",
      mediaUrl: "https://example.com/video",
    });

    expect(client.im.file.create).toHaveBeenNthCalledWith(1, {
      data: {
        file_type: "opus",
        file_name: "downloaded",
        file: expect.anything(),
        duration: 2222,
      },
    });
    expect(client.im.file.create).toHaveBeenNthCalledWith(2, {
      data: {
        file_type: "mp4",
        file_name: "downloaded",
        file: expect.anything(),
        duration: 2222,
      },
    });
  });
});
