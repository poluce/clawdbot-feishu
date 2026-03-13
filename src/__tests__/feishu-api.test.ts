import { describe, expect, it, vi } from "vitest";
import { errorResult, json, runFeishuApiCall } from "../tools-common/feishu-api.js";

describe("feishu-api", () => {
  it("wraps data with json helper", () => {
    const result = json({ ok: true });
    expect(result.details).toEqual({ ok: true });
    expect(result.content[0]?.text).toBe('{\n  "ok": true\n}');
  });

  it("wraps thrown errors with errorResult", () => {
    expect(errorResult(new Error("boom")).details).toEqual({ error: "boom" });
    expect(errorResult("oops").details).toEqual({ error: "oops" });
  });

  it("returns successful responses", async () => {
    await expect(
      runFeishuApiCall("test call", async () => ({ code: 0, msg: "ok" })),
    ).resolves.toEqual({ code: 0, msg: "ok" });
  });

  it("normalizes non-zero response errors", async () => {
    await expect(
      runFeishuApiCall("test call", async () => ({ code: 999, msg: "bad" })),
    ).rejects.toThrow("test call failed: bad, code=999");
  });

  it("retries retryable errors and eventually succeeds", async () => {
    const fn = vi
      .fn<() => Promise<{ code: number; msg: string }>>()
      .mockRejectedValueOnce({ code: 230020, msg: "rate limited" })
      .mockResolvedValueOnce({ code: 0, msg: "ok" });

    await expect(
      runFeishuApiCall("retry call", fn, {
        retryableCodes: [230020],
        backoffMs: [0],
      }),
    ).resolves.toEqual({ code: 0, msg: "ok" });

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("normalizes thrown response.data errors", async () => {
    await expect(
      runFeishuApiCall("nested call", async () => {
        throw {
          response: {
            data: {
              code: 400,
              msg: "permission denied",
              log_id: "log-123",
            },
          },
        };
      }),
    ).rejects.toThrow("nested call failed: permission denied, code=400, log_id=log-123");
  });

  it("normalizes nested array error payloads", async () => {
    await expect(
      runFeishuApiCall("array call", async () => {
        throw [new Error("ignored"), { code: 500, msg: "array error", log_id: "log-500" }];
      }),
    ).rejects.toThrow("array call failed: array error, code=500, log_id=log-500");
  });

  it("passes through plain Error instances without feishu metadata", async () => {
    await expect(
      runFeishuApiCall("plain call", async () => {
        throw new Error("plain error");
      }),
    ).rejects.toThrow("plain error");
  });

  it("normalizes plain object errors without response wrappers", async () => {
    await expect(
      runFeishuApiCall("object call", async () => {
        throw { code: 403, msg: "forbidden" };
      }),
    ).rejects.toThrow("object call failed: forbidden, code=403");
  });

  it("normalizes primitive thrown values", async () => {
    await expect(
      runFeishuApiCall("primitive call", async () => {
        throw "nope";
      }),
    ).rejects.toThrow("primitive call failed: nope");
  });

  it("includes log_id details from non-zero response payloads", async () => {
    await expect(
      runFeishuApiCall("logged call", async () => ({
        code: 500,
        msg: "boom",
        log_id: "log-500",
      })),
    ).rejects.toThrow("logged call failed: boom, code=500, log_id=log-500");
  });

  it("normalizes objects with nested response data only when available", async () => {
    await expect(
      runFeishuApiCall("wrapped call", async () => {
        throw {
          response: {
            data: {
              msg: "wrapped",
            },
          },
        };
      }),
    ).rejects.toThrow("wrapped call failed: wrapped");

    await expect(
      runFeishuApiCall("opaque object", async () => {
        throw {
          opaque: true,
        };
      }),
    ).rejects.toThrow("opaque object failed: [object Object]");
  });

  it("handles arrays with no extractable error info", async () => {
    await expect(
      runFeishuApiCall("array none", async () => {
        throw [null, 123];
      }),
    ).rejects.toThrow("array none failed: ,123");
  });
});
