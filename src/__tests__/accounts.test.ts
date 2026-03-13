import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import { describe, expect, it } from "vitest";
import {
  listEnabledFeishuAccounts,
  listFeishuAccountIds,
  resolveDefaultFeishuAccountId,
  resolveFeishuAccount,
  resolveFeishuCredentials,
} from "../accounts.js";

describe("accounts", () => {
  it("returns default account id when no accounts are configured", () => {
    expect(listFeishuAccountIds({} as any)).toEqual([DEFAULT_ACCOUNT_ID]);
    expect(resolveDefaultFeishuAccountId({} as any)).toBe(DEFAULT_ACCOUNT_ID);
  });

  it("sorts configured account ids", () => {
    const cfg = {
      channels: {
        clawdbot_feishu: {
          accounts: {
            zebra: {},
            alpha: {},
          },
        },
      },
    } as any;

    expect(listFeishuAccountIds(cfg)).toEqual(["alpha", "zebra"]);
    expect(resolveDefaultFeishuAccountId(cfg)).toBe("alpha");
  });

  it("resolves trimmed credentials and custom domain", () => {
    expect(
      resolveFeishuCredentials({
        appId: " cli_xxx ",
        appSecret: " secret ",
        encryptKey: " enc ",
        verificationToken: " token ",
        domain: "https://open.example.com",
      } as any),
    ).toEqual({
      appId: "cli_xxx",
      appSecret: "secret",
      encryptKey: "enc",
      verificationToken: "token",
      domain: "https://open.example.com",
    });
    expect(resolveFeishuCredentials({ appId: " ", appSecret: "secret" } as any)).toBeNull();
  });

  it("merges top-level config with account overrides", () => {
    const cfg = {
      channels: {
        clawdbot_feishu: {
          enabled: true,
          appId: "cli_base",
          appSecret: "base_secret",
          domain: "feishu",
          tts: { enabled: true },
          accounts: {
            secondary: {
              name: "  Secondary  ",
              appId: "cli_secondary",
              appSecret: "secondary_secret",
              domain: "lark",
              tts: { enabled: false },
            },
          },
        },
      },
    } as any;

    const account = resolveFeishuAccount({ cfg, accountId: "secondary" });

    expect(account).toMatchObject({
      accountId: "secondary",
      enabled: true,
      configured: true,
      name: "Secondary",
      appId: "cli_secondary",
      appSecret: "secondary_secret",
      domain: "lark",
    });
    expect(account.config.tts).toEqual({ enabled: false });
  });

  it("filters enabled and configured accounts", () => {
    const cfg = {
      channels: {
        clawdbot_feishu: {
          enabled: true,
          accounts: {
            ready: {
              appId: "cli_ready",
              appSecret: "ready_secret",
            },
            disabled: {
              enabled: false,
              appId: "cli_disabled",
              appSecret: "disabled_secret",
            },
            missingSecret: {
              appId: "cli_missing",
            },
          },
        },
      },
    } as any;

    const accounts = listEnabledFeishuAccounts(cfg);
    expect(accounts.map((account) => account.accountId)).toEqual(["ready"]);
  });

  it("falls back to top-level config when accounts map is missing", () => {
    const cfg = {
      channels: {
        clawdbot_feishu: {
          enabled: true,
          appId: "cli_top",
          appSecret: "top_secret",
        },
      },
    } as any;

    const account = resolveFeishuAccount({ cfg, accountId: "custom" });
    expect(account).toMatchObject({
      accountId: "custom",
      configured: true,
      appId: "cli_top",
      appSecret: "top_secret",
    });
  });
});
