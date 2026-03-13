# LLMtest

这个目录用于做 `clawdbot_feishu` 插件的真实场景验证，不是单元测试替代品。

目标：
- 用真实或准真实的 OpenClaw + Feishu/Lark 环境验证插件行为
- 让测试人员按统一脚本跑回归
- 记录每轮验证结果，方便和代码提交对应

## 适用范围

适合验证这些能力：
- 私聊文本回复
- 私聊语音模式切换与语音发送
- 群聊 mention 策略
- `feishu_voice` / `feishu_chat` / `feishu_doc` / `feishu_drive` / `feishu_wiki` / `feishu_task` 等工具
- 权限不足、资源未共享、TTS 缺依赖等真实环境问题

## 使用方式

1. 准备 OpenClaw 运行环境
2. 准备 Feishu/Lark 自建应用与事件订阅
3. 按 [openclaw.local.example.yaml](/F:/B_My_Document/GitHub/clawdbot-feishu/LLMtest/openclaw.local.example.yaml) 填写本地测试配置
4. 按 [real-world-cases.md](/F:/B_My_Document/GitHub/clawdbot-feishu/LLMtest/real-world-cases.md) 逐条执行
5. 把结果记录到 [results-template.md](/F:/B_My_Document/GitHub/clawdbot-feishu/LLMtest/results-template.md)

如果你只想在没有 OpenClaw 宿主的机器上模拟插件安装，可直接运行：

```bash
node LLMtest/simulate-plugin-install.mjs --json
```

如果想把文件真正复制到一个模拟插件目录里：

```bash
node LLMtest/simulate-plugin-install.mjs --copy
```

## 本地网页测试台

如果你想直接在浏览器里做真实通信测试，可启动本地网页测试台。
这条链路不依赖 OpenClaw 宿主，只直接复用本仓库里的插件函数和你的飞书凭据：

```powershell
pwsh -File .\LLMtest\start-web.ps1
```

或者：

```bash
npx tsx LLMtest/web/server.ts --port 3418
```

说明：
- `start-web.ps1` 会先检查仓库本地依赖。
- 如果缺少 `tsx`、`@larksuiteoapi/node-sdk` 或 `openclaw`，它会自动执行 `npm ci --ignore-scripts`。
- 这是为了让网页测试台能直接复用本仓库里的插件代码，不需要 OpenClaw 宿主。

启动后访问：

```text
http://127.0.0.1:3418
```

网页测试台支持：
- 连接探测
- App Scopes 权限检查
- 自动发现用户 / 群聊并回填 Target
- TTS 自检
- 文本 / Markdown 卡片 / 语音发送
- 获取消息
- Doc / Drive / Wiki / Chat / Perm / Bitable / Task / Urgent 工具测试

推荐使用方式：
- 基础连通测试时，只先填写 `App ID` 和 `App Secret`
- `Domain` 默认就是 `feishu`，`Account ID` 默认就是 `default`
- 先点“连接探测”或“应用权限”
- 再点“发现用户”或“发现群聊”，用点击结果的方式自动填充 `Target`
- 发送成功后，页面会自动回填 `Message ID`，方便继续测 `urgent` 或 `get message`

## 开始前检查

- 插件代码已经安装到 OpenClaw
- 当前插件配置键使用 `channels.clawdbot_feishu`
- 如果测试语音：
  - `edge-tts` 可用，或 `python -m edge_tts` / `py -m edge_tts` 可用
  - `ffmpeg` 可用
  - `ffprobe` 可用
- 如果测试文档/云盘/wiki/bitable/task：
  - Feishu 权限已批准
  - 目标资源已共享给机器人

## 建议回归顺序

1. `feishu_voice action=debug`
2. 私聊文本
3. 私聊语音与 `set_mode`
4. 群聊 mention / 非 mention
5. `feishu_chat`
6. `feishu_doc` / `feishu_drive` / `feishu_wiki`
7. `feishu_task`
8. 权限错误与异常分支

## 注意

- 这里的场景更偏“真实环境可执行说明”，不是自动化脚本。
- 如果你后面要接自动化集成测试，可以把这里的 case id 直接沿用。
