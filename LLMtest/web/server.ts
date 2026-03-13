import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFeishuClient } from "../../src/client.js";
import { resolveFeishuAccount } from "../../src/accounts.js";
import { listFeishuDirectoryGroupsLive, listFeishuDirectoryPeersLive } from "../../src/directory.js";
import { setFeishuRuntime } from "../../src/runtime.js";
import { probeFeishu } from "../../src/probe.js";
import {
  getMessageFeishu,
  sendCardFeishu,
  sendMarkdownCardFeishu,
  sendMessageFeishu,
  updateCardFeishu,
} from "../../src/send.js";
import {
  sendAudioFeishu,
  sendFileFeishu,
  sendImageFeishu,
  sendMediaFeishu,
  uploadFileFeishu,
  uploadImageFeishu,
} from "../../src/media.js";
import { getDebugInfo as getTTSDebugInfo, sendVoiceMessage } from "../../src/tts.js";
import { listAppScopes, runDocAction } from "../../src/doc-tools/actions.js";
import { runDriveAction } from "../../src/drive-tools/actions.js";
import { runWikiAction } from "../../src/wiki-tools/actions.js";
import { runChatAction } from "../../src/chat-tools/actions.js";
import { runPermAction } from "../../src/perm-tools/actions.js";
import { getBitableMeta } from "../../src/bitable-tools/meta.js";
import {
  batchDeleteRecords,
  createField,
  createRecord,
  deleteField,
  deleteRecord,
  getRecord,
  listFields,
  listRecords,
  updateField,
  updateRecord,
} from "../../src/bitable-tools/actions.js";
import { urgentMessageFeishu } from "../../src/urgent-tools/actions.js";
import {
  createTask,
  createTaskComment,
  createTasklist,
  deleteTask,
  getTask,
  getTaskComment,
  getTasklist,
  listTaskComments,
  listTasklists,
  updateTask,
} from "../../src/task-tools/actions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

type BenchCredentials = {
  appId: string;
  appSecret: string;
  domain?: string;
  accountId?: string;
  mediaMaxMb?: number;
  ttsEnabled?: boolean;
  ttsForce?: boolean;
};

function getArg(name: string, fallback: string) {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const port = Number.parseInt(getArg("port", "3418"), 10);

function detectContentType(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    default:
      return undefined;
  }
}

function okJson(res: http.ServerResponse, data: unknown, statusCode = 200) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function errorJson(res: http.ServerResponse, error: unknown, statusCode = 500) {
  const message = error instanceof Error ? error.message : String(error);
  okJson(
    res,
    {
      ok: false,
      error: message,
    },
    statusCode,
  );
}

async function readJsonBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function buildCfg(credentials: BenchCredentials) {
  return {
    channels: {
      clawdbot_feishu: {
        enabled: true,
        appId: credentials.appId,
        appSecret: credentials.appSecret,
        domain: credentials.domain || "feishu",
        mediaMaxMb: credentials.mediaMaxMb ?? 30,
        tts: {
          enabled: credentials.ttsEnabled !== false,
          force: credentials.ttsForce === true,
        },
        tools: {
          doc: true,
          wiki: true,
          drive: true,
          perm: true,
          scopes: true,
          task: true,
          chat: true,
          urgent: true,
          voice: true,
        },
      },
    },
  } as any;
}

async function loadWebMedia(urlOrPath: string, options: { maxBytes: number }) {
  if (/^https?:\/\//i.test(urlOrPath)) {
    const response = await fetch(urlOrPath);
    if (!response.ok) {
      throw new Error(`Failed to fetch remote media: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > options.maxBytes) {
      throw new Error(`Remote media exceeds ${(options.maxBytes / (1024 * 1024)).toFixed(2)}MB limit`);
    }
    const pathname = new URL(urlOrPath).pathname;
    return {
      buffer,
      fileName: path.basename(pathname) || "remote-file",
      contentType: response.headers.get("content-type") || undefined,
    };
  }

  const buffer = await fs.promises.readFile(urlOrPath);
  if (buffer.length > options.maxBytes) {
    throw new Error(`Local media exceeds ${(options.maxBytes / (1024 * 1024)).toFixed(2)}MB limit`);
  }
  return {
    buffer,
    fileName: path.basename(urlOrPath),
    contentType: detectContentType(urlOrPath),
  };
}

setFeishuRuntime({
  channel: {
    text: {
      resolveMarkdownTableMode: () => "ascii",
      convertMarkdownTables: (text: string) => text,
      chunkMarkdownText: (text: string) => [text],
      chunkTextWithMode: (text: string) => [text],
      resolveTextChunkLimit: () => 4000,
      resolveChunkMode: () => "length",
    },
    media: {
      fetchRemoteMedia: async ({ url, maxBytes }: { url: string; maxBytes: number }) =>
        loadWebMedia(url, { maxBytes }),
    },
  },
  media: {
    loadWebMedia: async (url: string, options: { maxBytes: number }) => loadWebMedia(url, options),
  },
} as any);

function resolveBenchClient(credentials: BenchCredentials) {
  const cfg = buildCfg(credentials);
  const account = resolveFeishuAccount({ cfg, accountId: credentials.accountId });
  const client = createFeishuClient(account);
  return { cfg, account, client };
}

async function runBitableAction(client: any, params: any) {
  switch (params.action) {
    case "meta":
      return getBitableMeta(client, params.url);
    case "list_fields":
      return listFields(client, params.app_token, params.table_id);
    case "list_records":
      return listRecords(client, params.app_token, params.table_id, params.page_size, params.page_token);
    case "get_record":
      return getRecord(client, params.app_token, params.table_id, params.record_id);
    case "create_record":
      return createRecord(client, params.app_token, params.table_id, params.fields);
    case "update_record":
      return updateRecord(client, params.app_token, params.table_id, params.record_id, params.fields);
    case "delete_record":
      return deleteRecord(client, params.app_token, params.table_id, params.record_id);
    case "batch_delete_records":
      return batchDeleteRecords(client, params.app_token, params.table_id, params.record_ids);
    case "create_field":
      return createField(client, params.app_token, params.table_id, params.field);
    case "update_field":
      return updateField(client, params.app_token, params.table_id, params.field_id, params.field);
    case "delete_field":
      return deleteField(client, params.app_token, params.table_id, params.field_id);
    default:
      throw new Error(`Unsupported bitable action: ${params.action}`);
  }
}

async function runTaskAction(client: any, params: any) {
  switch (params.action) {
    case "create":
      return createTask(client, params);
    case "get":
      return getTask(client, params);
    case "update":
      return updateTask(client, params);
    case "delete":
      return deleteTask(client, params.task_guid);
    case "list_tasklists":
      return listTasklists(client, params);
    case "get_tasklist":
      return getTasklist(client, params);
    case "create_tasklist":
      return createTasklist(client, params);
    case "create_comment":
      return createTaskComment(client, params);
    case "list_comments":
      return listTaskComments(client, params);
    case "get_comment":
      return getTaskComment(client, params);
    default:
      throw new Error(`Unsupported task action: ${params.action}`);
  }
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await readJsonBody(req);
  const { credentials = {}, params = {}, family } = body;
  const resolveContext = () => {
    const { cfg, account, client } = resolveBenchClient(credentials);
    const mediaMaxBytes = (account.config?.mediaMaxMb ?? 30) * 1024 * 1024;
    return { cfg, account, client, mediaMaxBytes };
  };

  switch (req.url) {
    case "/api/health":
      return okJson(res, { ok: true, service: "clawdbot_feishu LLMtest web bench" });
    case "/api/probe":
      return okJson(res, await probeFeishu(credentials));
    case "/api/app/scopes": {
      const { client } = resolveContext();
      return okJson(res, await listAppScopes(client as any));
    }
    case "/api/discover/users": {
      const { cfg, account } = resolveContext();
      return okJson(res, {
        items: await listFeishuDirectoryPeersLive({
          cfg,
          accountId: account.accountId,
          query: typeof params.query === "string" ? params.query : undefined,
          limit: typeof params.limit === "number" ? params.limit : 20,
        }),
      });
    }
    case "/api/discover/chats": {
      const { cfg, account } = resolveContext();
      return okJson(res, {
        items: await listFeishuDirectoryGroupsLive({
          cfg,
          accountId: account.accountId,
          query: typeof params.query === "string" ? params.query : undefined,
          limit: typeof params.limit === "number" ? params.limit : 20,
        }),
      });
    }
    case "/api/tts/debug":
      return okJson(res, getTTSDebugInfo());
    case "/api/send/text": {
      const { cfg, account } = resolveContext();
      return okJson(res, await sendMessageFeishu({ cfg, ...params, accountId: account.accountId }));
    }
    case "/api/send/card": {
      const { cfg, account } = resolveContext();
      return okJson(res, await sendCardFeishu({ cfg, ...params, accountId: account.accountId }));
    }
    case "/api/send/markdown-card": {
      const { cfg, account } = resolveContext();
      return okJson(res, await sendMarkdownCardFeishu({ cfg, ...params, accountId: account.accountId }));
    }
    case "/api/send/voice": {
      const { cfg, account } = resolveContext();
      return okJson(res, await sendVoiceMessage({ cfg, ...params, accountId: account.accountId }));
    }
    case "/api/send/image": {
      const { cfg, account } = resolveContext();
      return okJson(res, await sendImageFeishu({ cfg, ...params, accountId: account.accountId }));
    }
    case "/api/send/file": {
      const { cfg, account } = resolveContext();
      return okJson(res, await sendFileFeishu({ cfg, ...params, accountId: account.accountId }));
    }
    case "/api/send/audio": {
      const { cfg, account } = resolveContext();
      return okJson(res, await sendAudioFeishu({ cfg, ...params, accountId: account.accountId }));
    }
    case "/api/send/media": {
      const { cfg, account } = resolveContext();
      return okJson(res, await sendMediaFeishu({ cfg, ...params, accountId: account.accountId }));
    }
    case "/api/upload/image": {
      const { cfg, account } = resolveContext();
      return okJson(res, await uploadImageFeishu({ cfg, ...params, accountId: account.accountId }));
    }
    case "/api/upload/file": {
      const { cfg, account } = resolveContext();
      return okJson(res, await uploadFileFeishu({ cfg, ...params, accountId: account.accountId }));
    }
    case "/api/message/get": {
      const { cfg, account } = resolveContext();
      return okJson(res, await getMessageFeishu({ cfg, ...params, accountId: account.accountId }));
    }
    case "/api/card/update":
      {
        const { cfg, account } = resolveContext();
        await updateCardFeishu({ cfg, ...params, accountId: account.accountId });
      }
      return okJson(res, { ok: true });
    case "/api/tool/run": {
      const { client, mediaMaxBytes } = resolveContext();
      let result: unknown;
      switch (family) {
        case "doc":
          result = await runDocAction(client as any, params, mediaMaxBytes);
          break;
        case "wiki":
          result = await runWikiAction(client as any, params);
          break;
        case "drive":
          result = await runDriveAction(client as any, params, mediaMaxBytes);
          break;
        case "chat":
          result = await runChatAction(client as any, params);
          break;
        case "perm":
          result = await runPermAction(client as any, params);
          break;
        case "bitable":
          result = await runBitableAction(client as any, params);
          break;
        case "urgent":
          result = await urgentMessageFeishu({
            client,
            messageId: params.message_id,
            userIds: params.user_ids,
            urgentType: params.urgent_type,
          });
          break;
        case "task":
          result = await runTaskAction(client as any, params);
          break;
        default:
          throw new Error(`Unsupported tool family: ${family}`);
      }
      return okJson(res, result);
    }
    default:
      return errorJson(res, `Unknown API route: ${req.url}`, 404);
  }
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const requestPath = req.url === "/" ? "/index.html" : req.url || "/index.html";
  const normalized = requestPath.replace(/^\/+/, "");
  const filePath = path.join(publicDir, normalized);

  if (!filePath.startsWith(publicDir)) {
    return errorJson(res, "Invalid path", 400);
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return errorJson(res, "Not found", 404);
  }

  const contentType = detectContentType(filePath) || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

export function createBenchServer() {
  return http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        return errorJson(res, "Missing request URL", 400);
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        return res.end();
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.url.startsWith("/api/")) {
        if (req.method !== "POST") {
          return errorJson(res, "API endpoints require POST", 405);
        }
        return await handleApi(req, res);
      }
      return await serveStatic(req, res);
    } catch (error) {
      return errorJson(res, error, 500);
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = createBenchServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`LLMtest web bench listening on http://127.0.0.1:${port}`);
  });
}
