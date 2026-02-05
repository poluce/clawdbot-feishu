/**
 * Feishu Bot Menu Event Handler
 *
 * Handles `application.bot.menu_v6` events when users click bot menu items.
 * Menu items must be configured in Feishu Open Platform console.
 */

import type { ClawdbotConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import type { FeishuConfig } from "./types.js";
import { getFeishuRuntime } from "./runtime.js";
import { sendMessageFeishu } from "./send.js";

// Deduplication: track processed event IDs to prevent duplicate handling
const processedEventIds = new Set<string>();
const EVENT_ID_TTL_MS = 60 * 1000; // Keep event IDs for 1 minute

function markEventProcessed(eventId: string): boolean {
  if (processedEventIds.has(eventId)) {
    return false; // Already processed
  }
  processedEventIds.add(eventId);
  // Clean up after TTL
  setTimeout(() => processedEventIds.delete(eventId), EVENT_ID_TTL_MS);
  return true; // First time seeing this event
}

export type FeishuMenuEvent = {
  event_id?: string;
  token?: string;
  create_time?: string;
  event_type?: string;
  tenant_key?: string;
  ts?: string;
  uuid?: string;
  type?: string;
  app_id?: string;
  operator?: {
    operator_name?: string;
    operator_id?: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
  };
  event_key?: string;
  timestamp?: number;
};

export type MenuHandler = (params: {
  cfg: ClawdbotConfig;
  event: FeishuMenuEvent;
  operatorOpenId: string;
  runtime?: RuntimeEnv;
}) => Promise<void>;

/**
 * Get session status by parsing `openclaw status --json` output
 */
async function getSessionStatus(params: {
  operatorOpenId: string;
  cfg: ClawdbotConfig;
}): Promise<{
  model?: string;
  totalTokens?: number;
  contextTokens?: number;
  percentUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  compactions?: number;
} | null> {
  const core = getFeishuRuntime();

  // Resolve the session key for this user
  const route = core.channel.routing.resolveAgentRoute({
    cfg: params.cfg,
    channel: "feishu",
    peer: { kind: "dm", id: params.operatorOpenId },
  });

  const sessionKey = route.sessionKey;

  try {
    // Run openclaw status --json
    const result = await core.system.runCommandWithTimeout(
      ["openclaw", "status", "--json"],
      { timeoutMs: 5000 }
    );

    if (result.code !== 0) {
      return null;
    }

    // Parse JSON from stdout (skip any non-JSON lines like plugin logs)
    const lines = (result.stdout || "").split("\n");
    let jsonStr = "";
    let inJson = false;

    for (const line of lines) {
      if (line.startsWith("{")) {
        inJson = true;
      }
      if (inJson) {
        jsonStr += line + "\n";
      }
    }

    if (!jsonStr) {
      return null;
    }

    const status = JSON.parse(jsonStr);

    // Find the session in recent sessions
    const sessions = status.sessions?.recent ?? [];
    const session = sessions.find((s: { key?: string }) => s.key === sessionKey);

    if (!session) {
      // Return defaults if session not found
      return {
        model: status.sessions?.defaults?.model,
        contextTokens: status.sessions?.defaults?.contextTokens,
      };
    }

    return {
      model: session.model,
      totalTokens: session.totalTokens,
      contextTokens: session.contextTokens,
      percentUsed: session.percentUsed,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      compactions: session.compactions,
    };
  } catch {
    return null;
  }
}

// Built-in menu handlers
const builtinHandlers: Record<string, MenuHandler> = {
  /**
   * /status - Show session status (instant response)
   */
  status: async ({ cfg, operatorOpenId, runtime }) => {
    const log = runtime?.log ?? console.log;

    try {
      const status = await getSessionStatus({ operatorOpenId, cfg });

      if (!status) {
        await sendMessageFeishu({
          cfg,
          to: operatorOpenId,
          text: "❌ 获取状态失败",
        });
        return;
      }

      // Format status message (plain text for Feishu)
      const lines: string[] = ["📊 会话状态"];

      if (status.model) {
        lines.push(`• 模型: ${status.model}`);
      }

      if (status.totalTokens !== undefined && status.contextTokens !== undefined) {
        const pct = status.percentUsed ?? Math.round((status.totalTokens / status.contextTokens) * 100);
        const usedK = Math.round(status.totalTokens / 1000);
        const limitK = Math.round(status.contextTokens / 1000);
        lines.push(`• 上下文: ${usedK}k / ${limitK}k (${pct}%)`);
      }

      if (status.compactions !== undefined && status.compactions > 0) {
        lines.push(`• 已压缩: ${status.compactions} 次`);
      }

      if (status.inputTokens !== undefined || status.outputTokens !== undefined) {
        const inK = status.inputTokens ? Math.round(status.inputTokens / 1000) : 0;
        const outK = status.outputTokens ? Math.round(status.outputTokens / 1000) : 0;
        lines.push(`• Token: ${inK}k 输入 / ${outK}k 输出`);
      }

      const message = lines.join("\n");

      await sendMessageFeishu({
        cfg,
        to: operatorOpenId,
        text: message,
      });

      log(`feishu: /status responded to ${operatorOpenId}`);
    } catch (err) {
      log(`feishu: /status failed: ${String(err)}`);
      await sendMessageFeishu({
        cfg,
        to: operatorOpenId,
        text: "❌ 获取状态失败，请稍后重试",
      });
    }
  },

  /**
   * /help - Show available commands (instant response)
   */
  help: async ({ cfg, operatorOpenId, runtime }) => {
    const log = runtime?.log ?? console.log;

    const message = [
      "📖 可用命令",
      "",
      "• /status - 查看会话状态",
      "• /usage - 查看 Token 用量",
      "• /model - 查看当前模型",
      "• /clear - 清空会话历史",
      "• /help - 显示此帮助",
      "",
      "直接发消息即可与我对话～",
    ].join("\n");

    await sendMessageFeishu({
      cfg,
      to: operatorOpenId,
      text: message,
    });

    log(`feishu: /help responded to ${operatorOpenId}`);
  },

  /**
   * /usage - Show token usage (instant response)
   */
  usage: async ({ cfg, operatorOpenId, runtime }) => {
    const log = runtime?.log ?? console.log;

    try {
      const status = await getSessionStatus({ operatorOpenId, cfg });

      if (!status) {
        await sendMessageFeishu({
          cfg,
          to: operatorOpenId,
          text: "❌ 获取用量失败",
        });
        return;
      }

      const lines: string[] = ["📈 Token 用量"];

      if (status.totalTokens !== undefined && status.contextTokens !== undefined) {
        const pct = status.percentUsed ?? Math.round((status.totalTokens / status.contextTokens) * 100);
        const usedK = Math.round(status.totalTokens / 1000);
        const limitK = Math.round(status.contextTokens / 1000);
        lines.push(`• 上下文: ${usedK}k / ${limitK}k (${pct}%)`);
      }

      if (status.inputTokens !== undefined || status.outputTokens !== undefined) {
        const inK = status.inputTokens ? Math.round(status.inputTokens / 1000) : 0;
        const outK = status.outputTokens ? Math.round(status.outputTokens / 1000) : 0;
        lines.push(`• 输入: ${inK}k tokens`);
        lines.push(`• 输出: ${outK}k tokens`);
      }

      if (status.compactions !== undefined && status.compactions > 0) {
        lines.push(`• 已压缩: ${status.compactions} 次`);
      }

      const message = lines.join("\n");

      await sendMessageFeishu({
        cfg,
        to: operatorOpenId,
        text: message,
      });

      log(`feishu: /usage responded to ${operatorOpenId}`);
    } catch (err) {
      log(`feishu: /usage failed: ${String(err)}`);
      await sendMessageFeishu({
        cfg,
        to: operatorOpenId,
        text: "❌ 获取用量失败，请稍后重试",
      });
    }
  },

  /**
   * /model - Show current model (instant response)
   */
  model: async ({ cfg, operatorOpenId, runtime }) => {
    const log = runtime?.log ?? console.log;

    try {
      const status = await getSessionStatus({ operatorOpenId, cfg });

      if (!status) {
        await sendMessageFeishu({
          cfg,
          to: operatorOpenId,
          text: "❌ 获取模型信息失败",
        });
        return;
      }

      const lines: string[] = ["🤖 当前模型"];

      if (status.model) {
        lines.push(`• ${status.model}`);
      } else {
        lines.push("• 未知");
      }

      lines.push("");
      lines.push("切换模型请发送: /model <模型名>");

      const message = lines.join("\n");

      await sendMessageFeishu({
        cfg,
        to: operatorOpenId,
        text: message,
      });

      log(`feishu: /model responded to ${operatorOpenId}`);
    } catch (err) {
      log(`feishu: /model failed: ${String(err)}`);
      await sendMessageFeishu({
        cfg,
        to: operatorOpenId,
        text: "❌ 获取模型信息失败，请稍后重试",
      });
    }
  },

  /**
   * /clear - Clear session history (instant response)
   */
  clear: async ({ cfg, operatorOpenId, runtime }) => {
    const log = runtime?.log ?? console.log;

    const message = [
      "🗑️ 清空会话",
      "",
      "请发送 /reset 或 /new 来清空对话历史并开始新会话。",
      "",
      "注意: 清空后无法恢复之前的对话内容。",
    ].join("\n");

    await sendMessageFeishu({
      cfg,
      to: operatorOpenId,
      text: message,
    });

    log(`feishu: /clear responded to ${operatorOpenId}`);
  },
};

// Custom handlers registered by config or plugins
const customHandlers = new Map<string, MenuHandler>();

/**
 * Register a custom menu handler
 */
export function registerMenuHandler(eventKey: string, handler: MenuHandler): void {
  customHandlers.set(eventKey, handler);
}

/**
 * Unregister a custom menu handler
 */
export function unregisterMenuHandler(eventKey: string): void {
  customHandlers.delete(eventKey);
}

/**
 * Handle a bot menu event
 */
export async function handleFeishuMenuEvent(params: {
  cfg: ClawdbotConfig;
  event: FeishuMenuEvent;
  runtime?: RuntimeEnv;
}): Promise<void> {
  const { cfg, event, runtime } = params;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  const eventKey = event.event_key;
  const operatorOpenId = event.operator?.operator_id?.open_id;

  if (!eventKey) {
    log("feishu: menu event missing event_key, ignoring");
    return;
  }

  if (!operatorOpenId) {
    log("feishu: menu event missing operator open_id, ignoring");
    return;
  }

  // Deduplicate: check if we've already processed this event
  const eventId = event.event_id || event.uuid || `${eventKey}:${operatorOpenId}:${event.timestamp}`;
  if (!markEventProcessed(eventId)) {
    log(`feishu: menu event ${eventId} already processed, skipping`);
    return;
  }

  log(`feishu: menu event received - key=${eventKey}, operator=${operatorOpenId}, eventId=${eventId}`);

  // Check custom handlers first
  const customHandler = customHandlers.get(eventKey);
  if (customHandler) {
    try {
      await customHandler({ cfg, event, operatorOpenId, runtime });
      return;
    } catch (err) {
      error(`feishu: custom menu handler '${eventKey}' failed: ${String(err)}`);
      return;
    }
  }

  // Check builtin handlers
  const builtinHandler = builtinHandlers[eventKey];
  if (builtinHandler) {
    try {
      await builtinHandler({ cfg, event, operatorOpenId, runtime });
      return;
    } catch (err) {
      error(`feishu: builtin menu handler '${eventKey}' failed: ${String(err)}`);
      return;
    }
  }

  // No handler found - enqueue system event for agent to handle
  log(`feishu: no handler for menu key '${eventKey}', sending to agent via system event`);

  try {
    const core = getFeishuRuntime();

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "feishu",
      peer: { kind: "dm", id: operatorOpenId },
    });

    const commandText = `/${eventKey}`;

    // Just enqueue a system event - the agent will handle it and reply
    core.system.enqueueSystemEvent(`Feishu menu command: ${commandText}`, {
      sessionKey: route.sessionKey,
      contextKey: `feishu:menu:${eventKey}:${Date.now()}`,
    });
  } catch (err) {
    error(`feishu: failed to send menu event to agent: ${String(err)}`);
  }
}
