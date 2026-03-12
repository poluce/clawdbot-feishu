import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  listEnabledFeishuAccounts: vi.fn(),
  resolveDefaultFeishuAccountId: vi.fn(),
  resolveFeishuAccount: vi.fn(),
  createFeishuClient: vi.fn(),
  resolveToolsConfig: vi.fn(),
  getCurrentFeishuToolContext: vi.fn(),
}));

vi.mock("../accounts.js", () => ({
  listEnabledFeishuAccounts: mocked.listEnabledFeishuAccounts,
  resolveDefaultFeishuAccountId: mocked.resolveDefaultFeishuAccountId,
  resolveFeishuAccount: mocked.resolveFeishuAccount,
}));

vi.mock("../client.js", () => ({
  createFeishuClient: mocked.createFeishuClient,
}));

vi.mock("../tools-config.js", () => ({
  resolveToolsConfig: mocked.resolveToolsConfig,
}));

vi.mock("../tools-common/tool-context.js", () => ({
  getCurrentFeishuToolContext: mocked.getCurrentFeishuToolContext,
}));

import {
  hasFeishuToolEnabledForAnyAccount,
  resolveToolAccount,
  withFeishuToolClient,
} from "../tools-common/tool-exec.js";

describe("tool-exec", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks whether any account enables a given tool", () => {
    mocked.listEnabledFeishuAccounts.mockReturnValue([
      { config: { tools: { doc: false } } },
      { config: { tools: { doc: true } } },
    ]);
    mocked.resolveToolsConfig.mockImplementation((cfg) => ({
      doc: cfg?.doc ?? true,
    }));

    expect(hasFeishuToolEnabledForAnyAccount({} as any, "doc")).toBe(true);
    expect(hasFeishuToolEnabledForAnyAccount({} as any)).toBe(true);

    mocked.listEnabledFeishuAccounts.mockReturnValue([]);
    expect(hasFeishuToolEnabledForAnyAccount({} as any, "doc")).toBe(false);
  });

  it("resolves tool account from context when available", () => {
    const account = { accountId: "context-account" };
    mocked.getCurrentFeishuToolContext.mockReturnValue({
      channel: "clawdbot_feishu",
      accountId: "context-account",
    });
    mocked.resolveFeishuAccount.mockReturnValue(account);

    expect(resolveToolAccount({} as any)).toBe(account);
    expect(mocked.resolveFeishuAccount).toHaveBeenCalledWith({
      cfg: {},
      accountId: "context-account",
    });
  });

  it("falls back to the default account when context is missing", () => {
    const account = { accountId: "default-account" };
    mocked.getCurrentFeishuToolContext.mockReturnValue(undefined);
    mocked.resolveDefaultFeishuAccountId.mockReturnValue("default-account");
    mocked.resolveFeishuAccount.mockReturnValue(account);

    expect(resolveToolAccount({} as any)).toBe(account);
    expect(mocked.resolveDefaultFeishuAccountId).toHaveBeenCalled();
  });

  it("throws when config is unavailable", async () => {
    await expect(
      withFeishuToolClient({
        api: {} as any,
        toolName: "feishu_doc",
        run: async () => "ok",
      }),
    ).rejects.toThrow("Feishu config is not available");
  });

  it("throws for disabled, unconfigured, or tool-disabled accounts", async () => {
    mocked.getCurrentFeishuToolContext.mockReturnValue(undefined);
    mocked.resolveDefaultFeishuAccountId.mockReturnValue("acc");

    mocked.resolveFeishuAccount.mockReturnValueOnce({
      accountId: "acc",
      enabled: false,
      configured: true,
      config: {},
    });
    await expect(
      withFeishuToolClient({
        api: { config: {} } as any,
        toolName: "feishu_doc",
        run: async () => "ok",
      }),
    ).rejects.toThrow('Feishu account "acc" is disabled');

    mocked.resolveFeishuAccount.mockReturnValueOnce({
      accountId: "acc",
      enabled: true,
      configured: false,
      config: {},
    });
    await expect(
      withFeishuToolClient({
        api: { config: {} } as any,
        toolName: "feishu_doc",
        run: async () => "ok",
      }),
    ).rejects.toThrow('Feishu account "acc" is not configured');

    mocked.resolveFeishuAccount.mockReturnValueOnce({
      accountId: "acc",
      enabled: true,
      configured: true,
      config: { tools: { doc: false } },
    });
    mocked.resolveToolsConfig.mockReturnValue({ doc: false });
    await expect(
      withFeishuToolClient({
        api: { config: {} } as any,
        toolName: "feishu_doc",
        requiredTool: "doc",
        run: async () => "ok",
      }),
    ).rejects.toThrow('Feishu tool "feishu_doc" is disabled for account "acc"');
  });

  it("creates a client and executes the runner", async () => {
    const account = {
      accountId: "acc",
      enabled: true,
      configured: true,
      config: { tools: { doc: true } },
    };
    const client = { client: true };
    mocked.getCurrentFeishuToolContext.mockReturnValue(undefined);
    mocked.resolveDefaultFeishuAccountId.mockReturnValue("acc");
    mocked.resolveFeishuAccount.mockReturnValue(account);
    mocked.resolveToolsConfig.mockReturnValue({ doc: true });
    mocked.createFeishuClient.mockReturnValue(client);

    const result = await withFeishuToolClient({
      api: { config: {} } as any,
      toolName: "feishu_doc",
      requiredTool: "doc",
      run: async (args) => ({
        accountId: args.account.accountId,
        client: args.client,
      }),
    });

    expect(mocked.createFeishuClient).toHaveBeenCalledWith(account);
    expect(result).toEqual({ accountId: "acc", client });
  });
});
