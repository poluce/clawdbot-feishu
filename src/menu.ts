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

// Built-in menu handlers
const builtinHandlers: Record<string, MenuHandler> = {
  // Status command - show session status
  status: async ({ cfg, operatorOpenId, runtime }) => {
    const log = runtime?.log ?? console.log;
    log(`feishu: menu handler 'status' triggered by ${operatorOpenId}`);

    const core = getFeishuRuntime();

    // Route to agent as a /status command
    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "feishu",
      peer: { kind: "dm", id: operatorOpenId },
    });

    core.system.enqueueSystemEvent(`Feishu menu command: /status`, {
      sessionKey: route.sessionKey,
      contextKey: `feishu:menu:status:${Date.now()}`,
    });

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
    const body = core.channel.reply.formatAgentEnvelope({
      channel: "Feishu",
      from: operatorOpenId,
      timestamp: new Date(),
      envelope: envelopeOptions,
      body: "/status",
    });

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: body,
      RawBody: "/status",
      CommandBody: "/status",
      From: `feishu:${operatorOpenId}`,
      To: `user:${operatorOpenId}`,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: "direct",
      SenderName: operatorOpenId,
      SenderId: operatorOpenId,
      Provider: "feishu" as const,
      Surface: "feishu" as const,
      MessageSid: `menu:status:${Date.now()}`,
      Timestamp: Date.now(),
      WasMentioned: false,
      CommandAuthorized: true,
      OriginatingChannel: "feishu" as const,
      OriginatingTo: `user:${operatorOpenId}`,
    });

    const { createFeishuReplyDispatcher } = await import("./reply-dispatcher.js");
    const { dispatcher, replyOptions, markDispatchIdle } = createFeishuReplyDispatcher({
      cfg,
      agentId: route.agentId,
      runtime: runtime as RuntimeEnv,
      chatId: operatorOpenId,
    });

    await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });

    markDispatchIdle();
  },

  // Help command - show available commands
  help: async ({ cfg, operatorOpenId, runtime }) => {
    const log = runtime?.log ?? console.log;
    log(`feishu: menu handler 'help' triggered by ${operatorOpenId}`);

    const helpText = `🤖 可用命令：

/status - 查看会话状态
/help - 显示帮助信息

💡 提示：直接发消息即可与我对话`;

    await sendMessageFeishu({
      cfg,
      to: operatorOpenId,
      text: helpText,
    });
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

  log(`feishu: menu event received - key=${eventKey}, operator=${operatorOpenId}`);

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

  // No handler found - dispatch as generic command to agent
  log(`feishu: no handler for menu key '${eventKey}', dispatching to agent`);

  try {
    const core = getFeishuRuntime();

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "feishu",
      peer: { kind: "dm", id: operatorOpenId },
    });

    const commandText = `/${eventKey}`;

    core.system.enqueueSystemEvent(`Feishu menu command: ${commandText}`, {
      sessionKey: route.sessionKey,
      contextKey: `feishu:menu:${eventKey}:${Date.now()}`,
    });

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
    const body = core.channel.reply.formatAgentEnvelope({
      channel: "Feishu",
      from: operatorOpenId,
      timestamp: new Date(),
      envelope: envelopeOptions,
      body: commandText,
    });

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: body,
      RawBody: commandText,
      CommandBody: commandText,
      From: `feishu:${operatorOpenId}`,
      To: `user:${operatorOpenId}`,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: "direct",
      SenderName: event.operator?.operator_name ?? operatorOpenId,
      SenderId: operatorOpenId,
      Provider: "feishu" as const,
      Surface: "feishu" as const,
      MessageSid: `menu:${eventKey}:${Date.now()}`,
      Timestamp: Date.now(),
      WasMentioned: false,
      CommandAuthorized: true,
      OriginatingChannel: "feishu" as const,
      OriginatingTo: `user:${operatorOpenId}`,
    });

    const { createFeishuReplyDispatcher } = await import("./reply-dispatcher.js");
    const { dispatcher, replyOptions, markDispatchIdle } = createFeishuReplyDispatcher({
      cfg,
      agentId: route.agentId,
      runtime: runtime as RuntimeEnv,
      chatId: operatorOpenId,
    });

    await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });

    markDispatchIdle();
  } catch (err) {
    error(`feishu: failed to dispatch menu event to agent: ${String(err)}`);
  }
}
