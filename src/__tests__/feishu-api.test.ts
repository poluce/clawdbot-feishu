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
});
