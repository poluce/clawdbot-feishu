const output = document.getElementById("output");
const usersList = document.getElementById("usersList");
const chatsList = document.getElementById("chatsList");
const discoveryState = {
  users: [],
  chats: [],
};

const samplePayloads = {
  doc: { action: "read", doc_token: "doc_token_here" },
  drive: { action: "list" },
  wiki: { action: "spaces" },
  chat: { action: "check_bot_in_chat", chat_id: "oc_xxx" },
  perm: { action: "list", token: "file_token_here", type: "docx" },
  bitable: { action: "meta", url: "https://feishu.cn/base/appToken?table=tbl_xxx" },
  task: { action: "list_tasklists" },
  urgent: { message_id: "om_xxx", user_ids: ["ou_xxx"], urgent_type: "app" },
};

function el(id) {
  return document.getElementById(id);
}

function credentials() {
  return {
    appId: el("appId").value.trim(),
    appSecret: el("appSecret").value.trim(),
    domain: el("domain").value.trim() || "feishu",
    accountId: el("accountId").value.trim() || undefined,
    ttsEnabled: el("ttsEnabled").value === "true",
    ttsForce: el("ttsForce").value === "true",
  };
}

function appendLog(title, payload) {
  const stamp = new Date().toLocaleString();
  output.textContent = `[${stamp}] ${title}\n${JSON.stringify(payload, null, 2)}\n\n${output.textContent}`;
}

function setTargetValue(target, source, reason = "target selected") {
  el("target").value = target;
  appendLog(reason, { target, source });
}

function resolveImplicitTarget() {
  const explicit = el("target").value.trim();
  if (explicit) {
    return explicit;
  }

  const candidates = [];
  if (discoveryState.users.length === 1) {
    candidates.push(`user:${discoveryState.users[0].id}`);
  }
  if (discoveryState.chats.length === 1) {
    candidates.push(`chat:${discoveryState.chats[0].id}`);
  }

  return candidates.length === 1 ? candidates[0] : "";
}

function applyDerivedFields(result, fallbackTarget) {
  const messageId = result?.messageId || result?.message_id || result?.data?.message_id;
  if (messageId) {
    el("messageId").value = messageId;
  }

  const chatId = result?.chatId || result?.chat_id || result?.data?.chat_id;
  if (!el("target").value.trim() && chatId) {
    el("target").value = `chat:${chatId}`;
    return;
  }

  if (!el("target").value.trim() && fallbackTarget) {
    el("target").value = fallbackTarget;
  }
}

function requireCredentials() {
  const appId = el("appId").value.trim();
  const appSecret = el("appSecret").value.trim();
  if (!appId || !appSecret) {
    appendLog("validation", {
      error: "至少需要填写 App ID 和 App Secret",
    });
    return false;
  }
  return true;
}

function requireTarget() {
  const target = resolveImplicitTarget();
  if (!target) {
    appendLog("validation", {
      error: "还没有可用的 Target。请先点“发现用户/发现群聊”并选择目标，或手动填写 Target。",
    });
    return null;
  }

  if (!el("target").value.trim()) {
    setTargetValue(target, { auto: true }, "target auto-filled");
  }

  return target;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || `HTTP ${response.status}`);
  }
  return json;
}

async function run(title, url, body, options = {}) {
  if (options.requireCredentials && !requireCredentials()) {
    return;
  }
  try {
    const result = await postJson(url, body);
    applyDerivedFields(result, options.fallbackTarget);
    appendLog(title, result);
  } catch (error) {
    appendLog(`${title} (ERROR)`, { error: error.message || String(error) });
  }
}

function renderDiscoverList(container, items, kind) {
  if (kind === "user") {
    discoveryState.users = items || [];
  } else {
    discoveryState.chats = items || [];
  }

  container.innerHTML = "";
  if (!items || items.length === 0) {
    container.className = "discovery-list empty";
    container.textContent = "没有找到结果";
    return;
  }

  container.className = "discovery-list";
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "discovery-item";
    button.textContent = item.name ? `${item.name} (${item.id})` : item.id;
    button.addEventListener("click", () => {
      setTargetValue(`${kind}:${item.id}`, item);
    });
    container.appendChild(button);
  }

  if (items.length === 1 && !el("target").value.trim()) {
    setTargetValue(`${kind}:${items[0].id}`, { auto: true, item: items[0] }, "target auto-selected");
  }
}

async function runDiscovery(kind) {
  if (!requireCredentials()) {
    return;
  }

  const url = kind === "user" ? "/api/discover/users" : "/api/discover/chats";
  const title = kind === "user" ? "discover users" : "discover chats";
  try {
    const result = await postJson(url, {
      credentials: credentials(),
      params: {
        query: el("discoverQuery").value.trim() || undefined,
        limit: 20,
      },
    });
    renderDiscoverList(kind === "user" ? usersList : chatsList, result.items, kind === "user" ? "user" : "chat");
    appendLog(title, result);
  } catch (error) {
    appendLog(`${title} (ERROR)`, { error: error.message || String(error) });
  }
}

document.getElementById("healthBtn").addEventListener("click", () =>
  run("health", "/api/health", { credentials: credentials() }),
);

document.getElementById("probeBtn").addEventListener("click", () =>
  run("probe", "/api/probe", { credentials: credentials() }, { requireCredentials: true }),
);

document.getElementById("scopesBtn").addEventListener("click", () =>
  run("app scopes", "/api/app/scopes", { credentials: credentials() }, { requireCredentials: true }),
);

document.getElementById("discoverUsersBtn").addEventListener("click", () => runDiscovery("user"));
document.getElementById("discoverChatsBtn").addEventListener("click", () => runDiscovery("chat"));

document.getElementById("ttsDebugBtn").addEventListener("click", () =>
  run("tts debug", "/api/tts/debug", { credentials: credentials() }),
);

document.getElementById("sendTextBtn").addEventListener("click", () =>
  {
    const target = requireTarget();
    if (!target) {
      return;
    }
    run(
      "send text",
      "/api/send/text",
      {
        credentials: credentials(),
        params: {
          to: target,
          text: el("messageText").value,
        },
      },
      { requireCredentials: true, fallbackTarget: target },
    );
  },
);

document.getElementById("sendMarkdownCardBtn").addEventListener("click", () =>
  {
    const target = requireTarget();
    if (!target) {
      return;
    }
    run(
      "send markdown card",
      "/api/send/markdown-card",
      {
        credentials: credentials(),
        params: {
          to: target,
          text: el("messageText").value,
        },
      },
      { requireCredentials: true, fallbackTarget: target },
    );
  },
);

document.getElementById("sendVoiceBtn").addEventListener("click", () =>
  {
    const target = requireTarget();
    if (!target) {
      return;
    }
    run(
      "send voice",
      "/api/send/voice",
      {
        credentials: credentials(),
        params: {
          to: target,
          text: el("messageText").value,
        },
      },
      { requireCredentials: true, fallbackTarget: target },
    );
  },
);

document.getElementById("getMessageBtn").addEventListener("click", () =>
  run(
    "get message",
    "/api/message/get",
    {
      credentials: credentials(),
      params: {
        messageId: el("messageId").value.trim(),
      },
    },
    { requireCredentials: true },
  ),
);

for (const button of document.querySelectorAll(".sampleBtn")) {
  button.addEventListener("click", () => {
    const family = button.dataset.family;
    el("toolFamily").value = family;
    const payload = structuredClone(samplePayloads[family]);
    if (family === "urgent" && el("messageId").value.trim()) {
      payload.message_id = el("messageId").value.trim();
    }
    el("toolParams").value = JSON.stringify(payload, null, 2);
  });
}

document.getElementById("runToolBtn").addEventListener("click", () =>
  run(
    `tool ${el("toolFamily").value}`,
    "/api/tool/run",
    {
      credentials: credentials(),
      family: el("toolFamily").value,
      params: JSON.parse(el("toolParams").value || "{}"),
    },
    { requireCredentials: true },
  ),
);

document.getElementById("clearLogBtn").addEventListener("click", () => {
  output.textContent = "";
});

appendLog("ready", {
  message: "LLMtest web bench loaded",
  hints: [
    "先填 App ID / App Secret",
    "优先点连接探测 / 应用权限 / 发现用户 / 发现群聊",
    "点发现结果可自动写入 Target",
    "发送成功后 Message ID 会自动回填",
  ],
});
