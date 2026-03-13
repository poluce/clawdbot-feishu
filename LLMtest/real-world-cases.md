# Real-World Cases

## Case 01: 私聊基础文本回复

目的：
- 验证私聊消息能正确进站、分发、回文本

建议输入给 LLM：
```text
请用一句话介绍你自己。
```

期望：
- 机器人正常回复文本
- 不报权限错误
- reply 目标仍然是当前 DM 用户

## Case 02: 语音能力自检

目的：
- 验证 `feishu_voice` 工具是否存在
- 验证 TTS 依赖是否完整

建议输入给 LLM：
```json
{ "action": "debug" }
```

期望：
- 工具存在且可调用
- 返回 `ttsAvailable`
- 缺依赖时能明确指出缺的是哪一个

## Case 03: 临时切文本模式

目的：
- 验证 LLM 可通过工具控制语音模式

建议输入给 LLM：
```json
{ "action": "set_mode", "mode": "text", "duration_minutes": 30 }
```

然后发送普通短消息：
```text
你现在给我回一句短话。
```

期望：
- `set_mode` 成功
- 后续短回复走文本而不是语音

## Case 04: 临时切自动模式

建议输入给 LLM：
```json
{ "action": "set_mode", "mode": "auto" }
```

期望：
- 模式恢复自动
- 短回复按自动规则决定语音或文本

## Case 05: 显式发送语音

建议输入给 LLM：
```json
{ "action": "send", "text": "这是一条语音测试消息" }
```

期望：
- 当前私聊会话里收到音频消息
- 如果缺少 TTS 依赖，应明确失败原因

## Case 06: 群聊 mention 必须触发

准备：
- `requireMention: true`
- 机器人已在测试群

步骤：
1. 群里发送普通文本，不 @ 机器人
2. 群里再发送一条，显式 @ 机器人

期望：
- 第 1 条不触发
- 第 2 条触发

## Case 07: `feishu_chat` 群公告读取

建议输入给 LLM：
```text
调用 feishu_chat，读取当前测试群的公告信息。
```

期望：
- 工具调用成功
- 返回当前群公告结构

## Case 08: `feishu_doc` 文档读写

准备：
- 文档已共享给机器人

建议输入给 LLM：
```text
读取这篇飞书文档，然后追加一段“LLMtest append check”。
```

期望：
- 读成功
- 追加成功
- 文档内实际可见新内容

## Case 09: `feishu_drive` 导入文档

建议输入给 LLM：
```text
用 feishu_drive 把一段 markdown 导入成新文档。
```

期望：
- 新文档创建成功
- 内容结构基本正确

## Case 10: `feishu_wiki` 浏览与搜索

建议输入给 LLM：
```text
列出当前 wiki space，然后搜索一个已知关键字。
```

期望：
- space 可列出
- 搜索结果非空或至少行为符合预期

## Case 11: `feishu_task` 任务流

建议输入给 LLM：
```text
创建一个测试任务，更新状态，再添加一条评论。
```

期望：
- 任务创建成功
- 更新成功
- 评论成功

## Case 12: 权限不足提示

准备：
- 故意撤掉某个工具所需权限，或访问一个未共享资源

期望：
- 调用失败时，错误说明清楚
- 如果是 Feishu 权限错误，应尽量给出授权线索

