import { describe, expect, it } from "vitest";
import { getCurrentFeishuToolContext, runWithFeishuToolContext } from "../tools-common/tool-context.js";

describe("tool-context", () => {
  it("provides context inside the callback and clears it afterwards", () => {
    expect(getCurrentFeishuToolContext()).toBeUndefined();

    const inside = runWithFeishuToolContext(
      {
        channel: "clawdbot_feishu",
        accountId: "acc_1",
        chatId: "oc_123",
      },
      () => getCurrentFeishuToolContext(),
    );

    expect(inside).toEqual({
      channel: "clawdbot_feishu",
      accountId: "acc_1",
      chatId: "oc_123",
    });
    expect(getCurrentFeishuToolContext()).toBeUndefined();
  });

  it("keeps context across async boundaries", async () => {
    const inside = await runWithFeishuToolContext(
      {
        channel: "clawdbot_feishu",
        accountId: "acc_async",
        sessionKey: "session_1",
      },
      async () => {
        await Promise.resolve();
        return getCurrentFeishuToolContext();
      },
    );

    expect(inside?.accountId).toBe("acc_async");
    expect(inside?.sessionKey).toBe("session_1");
  });
});
