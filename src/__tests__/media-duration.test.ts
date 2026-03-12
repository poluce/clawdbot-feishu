import { describe, expect, it } from "vitest";
import {
  parseFeishuMediaDurationMs,
  parseMp4DurationMs,
  parseOggDurationMs,
  parseWavDurationMs,
} from "../media-duration.js";

function makeOggPage(granulePosition: number, payload: Buffer) {
  const header = Buffer.alloc(28);
  header.write("OggS", 0, "ascii");
  header.writeUInt8(0, 4);
  header.writeUInt8(0, 5);
  header.writeBigUInt64LE(BigInt(granulePosition), 6);
  header.writeUInt32LE(1, 14);
  header.writeUInt32LE(0, 18);
  header.writeUInt32LE(0, 22);
  header.writeUInt8(1, 26);
  header.writeUInt8(payload.length, 27);
  return Buffer.concat([header, payload]);
}

function makeBox(type: string, payload: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function makeWav(byteRate: number, dataSize: number) {
  const riffHeader = Buffer.alloc(12);
  riffHeader.write("RIFF", 0, "ascii");
  riffHeader.writeUInt32LE(36 + dataSize, 4);
  riffHeader.write("WAVE", 8, "ascii");

  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "ascii");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(16000, 12);
  fmt.writeUInt32LE(byteRate, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);

  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0, "ascii");
  dataHeader.writeUInt32LE(dataSize, 4);

  return Buffer.concat([riffHeader, fmt, dataHeader, Buffer.alloc(dataSize)]);
}

describe("media-duration", () => {
  it("parses opus ogg duration", () => {
    const payload = Buffer.concat([Buffer.from("OpusHead", "ascii"), Buffer.from([0])]);
    const ogg = makeOggPage(48_000, payload);
    expect(parseOggDurationMs(ogg)).toBe(1000);
    expect(parseFeishuMediaDurationMs(ogg, "opus")).toBe(1000);
  });

  it("parses mp4 duration", () => {
    const mvhdPayload = Buffer.alloc(20);
    mvhdPayload.writeUInt8(0, 0);
    mvhdPayload.writeUInt32BE(1000, 12);
    mvhdPayload.writeUInt32BE(2500, 16);
    const mp4 = makeBox("moov", makeBox("mvhd", mvhdPayload));

    expect(parseMp4DurationMs(mp4)).toBe(2500);
    expect(parseFeishuMediaDurationMs(mp4, "mp4")).toBe(2500);
  });

  it("parses wav duration", () => {
    const wav = makeWav(32_000, 64_000);
    expect(parseWavDurationMs(wav)).toBe(2000);
    expect(parseFeishuMediaDurationMs(wav, "opus")).toBe(2000);
  });

  it("returns undefined for invalid buffers", () => {
    const invalid = Buffer.from("not-media");
    expect(parseOggDurationMs(invalid)).toBeUndefined();
    expect(parseMp4DurationMs(invalid)).toBeUndefined();
    expect(parseWavDurationMs(invalid)).toBeUndefined();
  });
});
