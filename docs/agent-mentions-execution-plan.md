# Agent Mention 公开多 Agent 对话开发文档

## 1. 文档目标

本文档用于指导 `jkq-cc-connect` 实现一套“公开多 Agent 对话”能力。

目标不是让多个 Agent 在后台静默协作后只返回摘要，而是让它们在同一个聊天窗口中公开交流。

用户期望的典型流程如下：

1. 用户输入：`@agent1 看看 @agent2 在干嘛`
2. `agent1` 在聊天窗口里公开询问 `agent2`
3. `agent2` 在聊天窗口里公开回复 `agent1`
4. `agent1` 再面向用户总结 `agent2` 当前在做什么

这意味着系统需要支持：

- 用户对 Agent 发起任务
- Agent 对 Agent 发消息
- Agent 在同一个聊天窗口里公开回复
- 系统按回合路由 Agent 间的消息

本文档是当前需求的正式开发方案。

## 2. 核心需求重定义

### 2.1 真实需求

本需求不是：

- 多 Agent 在后台互相协作
- 最后只给用户一个隐藏过程后的摘要

本需求是：

- 多 Agent 的沟通过程可以公开出现在聊天窗口中
- 用户可以看到 Agent 之间是如何发起问题、回应问题、再汇总结论的

### 2.2 关键能力

系统需要支持三类消息发送者：

1. `user`
2. `agent`
3. `system`

同时还需要支持“消息目标”概念：

1. 用户发给某个 Agent
2. Agent 发给另一个 Agent
3. Agent 回给用户

## 3. 已确认的交互规则

### 3.1 `@` 唤起规则

- 当用户在输入框中输入 `@` 时，弹出当前 CLI 下的所有 Agent 列表。
- 列表支持滚动、键盘选择、鼠标选择。
- 当前模式为 `claude` 时，弹出 `Claude` Agent 列表。
- 当前模式为 `codex` 时，弹出 `Codex` Agent 列表。
- 当前模式为 `opencode` 时，弹出 `OpenCode` Agent 列表。
- 当前模式为 `auto` 时，默认弹出 `Claude` Agent 列表。
- 当前模式为 `parallel` 时，当前版本也默认弹出 `Claude` Agent 列表，保持一致。

### 3.2 用户输入规则

- 用户只输入 `@agent名称`
- 用户不需要关心内部 `agentId`、`toolId`、消息路由结构
- 前端负责把 `@agent名称` 解析成结构化 mention

### 3.3 公开对话规则

- 当用户点名 `@agent1`，则 `agent1` 成为本轮主处理 Agent
- 如果用户消息里还包含 `@agent2`，则 `agent1` 可以围绕该目标 Agent 发起公开询问
- `agent1` 对 `agent2` 的提问会显示在聊天窗口中
- `agent2` 的回复也会显示在聊天窗口中
- `agent1` 最后再给用户结论

### 3.4 执行约束

- 第一阶段只支持同一个 CLI 下的 Agent 互相对话
- 第一阶段只支持串行回合制，不做并行
- 第一阶段建议限制：
  - 每轮最多 3 个 Agent 参与
  - 最大公开对话深度为 4 轮
  - 同一 session 同时只跑一条 Agent 编排链

## 4. 当前代码现状

### 4.1 前端

- 输入框当前只支持 `/` 命令补全，不支持 `@agent`
  - 文件：[client/src/components/chat/ChatInput.vue](/D:/demo/jkq-cc-connect/client/src/components/chat/ChatInput.vue)
- 当前 CLI 和 Agent 数据已经在前端可拿到
  - 文件：[client/src/stores/vibe.ts](/D:/demo/jkq-cc-connect/client/src/stores/vibe.ts)
  - 类型：[client/src/types/index.ts](/D:/demo/jkq-cc-connect/client/src/types/index.ts)
- 消息列表当前主要面向“用户 + assistant + tool 输出”，没有单独的 Agent 对 Agent 消息建模
  - 文件：[client/src/stores/chat.ts](/D:/demo/jkq-cc-connect/client/src/stores/chat.ts)

### 4.2 后端

- 服务端能探测各 CLI 的 Agent 列表，但目前只用于展示
  - 文件：[server/src/tools/vibe.ts](/D:/demo/jkq-cc-connect/server/src/tools/vibe.ts)
- 当前 WebSocket 输入协议没有 mentions
  - 文件：[server/src/types/index.ts](/D:/demo/jkq-cc-connect/server/src/types/index.ts)
- 当前执行模型是“单输入 -> 单工具 -> 单个 active agent”
  - 文件：[server/src/ws/gateway.ts](/D:/demo/jkq-cc-connect/server/src/ws/gateway.ts)
  - 文件：[server/src/cc/manager.ts](/D:/demo/jkq-cc-connect/server/src/cc/manager.ts)

## 5. 用户视角下的目标行为

### 5.1 示例

用户输入：

```text
@agent1 看看 @agent2 在干嘛
```

聊天窗口预期看到类似内容：

```text
用户：@agent1 看看 @agent2 在干嘛

agent1：@agent2 你现在在做什么？

agent2：我正在处理 xxx，当前进度是 yyy。

agent1：agent2 现在正在处理 xxx，当前进度是 yyy。
```

这四条消息都应该在聊天窗口中明确展示来源。

### 5.2 UI 呈现要求

- 用户能看出每条消息是谁发的
- Agent 发给 Agent 的消息也要清晰标注
- 消息来源建议显示：
  - `用户`
  - `Claude / agent1`
  - `Claude / agent2`
- 如果某条消息是“agent 发给 agent”，可在 metadata 中增加目标信息，前端可显示为：
  - `agent1 -> agent2`
  - `agent2 -> agent1`

## 6. 设计决策

### 6.1 总体方案

采用“应用层公开多 Agent 编排”方案。

这意味着：

- 前端负责 mention 选择和结构化发送
- 后端负责消息路由和回合控制
- CLI 仍然作为单 Agent 执行器
- 多 Agent 会话由应用层 orchestrator 驱动

### 6.2 为什么这样设计

原因如下：

1. 当前不同 CLI 的原生多 Agent 能力并不统一
2. 公开对话需要应用层统一控制展示顺序
3. Agent 间消息需要显式注入聊天记录与 metadata
4. 后续如果某个 CLI 有更强原生支持，也可以在 adapter 层逐步接入

## 7. 协议设计

## 7.1 Mention 结构

前端发送时，除了原始 `text`，还要带结构化 `mentions`。

建议新增类型：

```ts
export interface AgentMention {
  toolId: VibeToolId
  agentId: string
  name: string
  order: number
}
```

说明：

- `toolId`：当前所属 CLI
- `agentId`：真实 Agent 唯一标识
- `name`：展示名称
- `order`：在用户文本中出现的顺序

### 7.2 输入消息结构

扩展 `input` 消息：

```ts
{
  type: 'input',
  text: string,
  sessionId: string,
  mode?: ToolExecutionMode,
  mentions?: AgentMention[]
}
```

### 7.3 聊天消息展示结构

为了支持公开多 Agent 对话，建议在前后端消息 metadata 中增加：

```ts
{
  senderType: 'user' | 'agent' | 'system',
  senderAgentId?: string,
  senderAgentName?: string,
  targetAgentId?: string,
  targetAgentName?: string,
  visibleToUser: true,
  orchestrationStep?: 'user_request' | 'agent_to_agent' | 'agent_reply' | 'agent_to_user'
}
```

说明：

- `senderType` 用于区分消息来源
- `targetAgentId` 用于表达这条消息是发给谁的
- `orchestrationStep` 用于前端渲染时做轻量区分

## 8. 前端实现方案

### 8.1 涉及文件

- [client/src/components/chat/ChatInput.vue](/D:/demo/jkq-cc-connect/client/src/components/chat/ChatInput.vue)
- [client/src/stores/chat.ts](/D:/demo/jkq-cc-connect/client/src/stores/chat.ts)
- [client/src/types/index.ts](/D:/demo/jkq-cc-connect/client/src/types/index.ts)
- 可选新增：
  - `client/src/utils/mentions.ts`

### 8.2 输入框改造

在 `ChatInput.vue` 中新增：

- `@` 触发检测
- mention 候选弹层
- 当前 CLI Agent 数据源选择
- 键盘上下移动
- 回车 / Tab 选中
- 鼠标点击选中
- 多 mention 记录

### 8.3 列表数据来源

候选 Agent 只取当前 CLI 的数据：

- `claude` -> `Claude` agents
- `codex` -> `Codex` agents
- `opencode` -> `OpenCode` agents
- `auto` -> `Claude` agents
- `parallel` -> `Claude` agents

### 8.4 列表滚动要求

候选弹层建议复用现有 `/` 菜单风格，并增加：

- `max-h-64`
- `overflow-y-auto`
- `overscroll-contain`

### 8.5 发送时的结构化拼接

用户输入示例：

```text
@agent1 看看 @agent2 在干嘛
```

前端发送：

```json
{
  "type": "input",
  "text": "@agent1 看看 @agent2 在干嘛",
  "sessionId": "session-123",
  "mode": "claude",
  "mentions": [
    {
      "toolId": "claude",
      "agentId": "claude:agent1",
      "name": "agent1",
      "order": 0
    },
    {
      "toolId": "claude",
      "agentId": "claude:agent2",
      "name": "agent2",
      "order": 1
    }
  ]
}
```

### 8.6 前端必须遵守的规则

- 只有从候选列表选中的 Agent 才是有效 mention
- 用户手输一个不存在的 `@abc` 不生成 mention
- 若用户删除了文本里的 `@agent名称`，要同步清理 mention 记录
- `text` 必须保留原始输入，以便聊天记录如实展示

## 9. 后端实现方案

### 9.1 涉及文件

- [server/src/types/index.ts](/D:/demo/jkq-cc-connect/server/src/types/index.ts)
- [server/src/ws/gateway.ts](/D:/demo/jkq-cc-connect/server/src/ws/gateway.ts)
- [server/src/cc/manager.ts](/D:/demo/jkq-cc-connect/server/src/cc/manager.ts)
- 新增：
  - `server/src/agents/orchestrator.ts`
  - 或 `server/src/cc/orchestrator.ts`

### 9.2 新增 Agent Orchestrator

新增一个会话级 orchestrator，负责：

1. 接收用户输入及 mentions
2. 确定主 Agent
3. 识别消息中的目标 Agent
4. 管理 Agent 之间的公开对话回合
5. 将每条 Agent 消息广播给前端
6. 控制最大深度、失败回退和超时

### 9.3 gateway 的职责

在 [server/src/ws/gateway.ts](/D:/demo/jkq-cc-connect/server/src/ws/gateway.ts) 中：

- 如果 `input` 没有 mentions，继续走旧逻辑
- 如果 `input` 有 mentions，则转入 orchestrator
- orchestrator 返回的每一步公开消息都通过现有广播链发给前端

### 9.4 CCManager 的职责

`CCManager` 继续做“单个 Agent 执行器”，不直接负责多 Agent 编排。

建议扩展：

- `start(projectDir, inputText, tool, options?)`

其中 `options` 可包含：

```ts
{
  agentName?: string
  agentLabel?: string
  systemInstruction?: string
}
```

这样同一个 CLI 下，orchestrator 就可以显式要求“请以 agent2 身份回复”。

## 10. 公开多 Agent 对话流程

### 10.1 基础流程

#### 第一步：用户请求主 Agent

用户：

```text
@agent1 看看 @agent2 在干嘛
```

orchestrator 判断：

- 主 Agent：`agent1`
- 用户在问题中提到了目标 Agent：`agent2`

#### 第二步：主 Agent 公开提问

系统把任务交给 `agent1`。

`agent1` 的 prompt 应包含规则：

- 如果需要向被提及的 Agent 询问，请明确生成“发给该 Agent 的公开消息”
- 不要直接假设对方状态

然后 `agent1` 产出：

```text
@agent2 你现在在做什么？
```

系统将这条消息作为一条公开消息写入聊天窗口。

#### 第三步：目标 Agent 公开回复

orchestrator 捕获到这是一条 `agent1 -> agent2` 的消息，然后调用 `agent2`。

`agent2` 回复：

```text
我正在处理 xxx，当前进度是 yyy。
```

系统将这条消息作为一条公开消息写入聊天窗口。

#### 第四步：主 Agent 汇总回复用户

orchestrator 再把 `agent2` 的回复回填给 `agent1`。

`agent1` 最后面向用户输出：

```text
agent2 现在正在处理 xxx，当前进度是 yyy。
```

这条消息也写入聊天窗口。

### 10.2 关键点

- Agent 间对话不是隐藏过程
- 每一轮消息都要广播给用户
- orchestrator 负责区分“这是普通回复”还是“这是发给另一个 Agent 的消息”

## 11. Agent 对 Agent 消息识别方案

### 11.1 第一阶段推荐方案

第一阶段不要做太复杂的自由解析，建议用显式约束。

例如要求主 Agent 在需要呼叫其他 Agent 时，输出结构化前缀：

```text
@agent2 你现在在做什么？
```

orchestrator 识别规则：

- 若消息开头匹配 `@agentName`
- 且 `agentName` 属于当前会话允许的 Agent 集合
- 且当前消息发送者是 Agent

则将这条消息判定为“Agent 对 Agent 的公开提问”

### 11.2 为什么先用这个方案

原因：

- 规则简单
- 易于调试
- 便于在日志中排查
- 先满足当前需求，再逐步升级

## 12. 安全与保护规则

### 12.1 深度限制

为避免 Agent 无限互相对话，建议：

- 最大回合深度：4
- 超过后由 system 打断，并提示主 Agent 收束回答

### 12.2 参与数量限制

- 单次请求最多允许 3 个 Agent 参与
- 超过则拒绝并提示用户精简

### 12.3 CLI 范围限制

- 第一阶段不允许跨 CLI Agent 混用
- 若当前文本里的 mention 不属于当前 CLI，前端直接拦截或后端拒绝

### 12.4 失败回退

- 若被询问的 Agent 不存在，直接返回错误
- 若被询问的 Agent 执行超时，系统向聊天窗口插入 system 消息
- 若主 Agent 无法收束，系统终止本轮编排

## 13. 消息展示建议

### 13.1 当前阶段建议

先不做复杂卡片，继续复用现有文本消息组件。

但建议在 metadata 中加来源信息，让前端可以区分展示：

- `用户`
- `agent1 -> agent2`
- `agent2 -> agent1`
- `agent1 -> 用户`

### 13.2 展示样式建议

建议消息头部展示：

- `用户`
- `Claude / agent1`
- `Claude / agent2`

可选展示副标题：

- `发给 agent2`
- `回复 agent1`

## 14. 分阶段实施方案

### 第一阶段：单 Agent Mention 定向执行

目标：

- 输入 `@` 弹出当前 CLI Agent 列表
- 支持滚动
- 支持选中单个 Agent
- 发送时附带结构化 mentions
- 后端能把请求交给指定 Agent 执行

验收标准：

- `@agent1 帮我做 xxx` 能稳定执行
- 无 mention 输入不受影响
- `/` 菜单不回归

### 第二阶段：公开 Agent 对 Agent 对话

目标：

- 用户消息中出现多个 `@agent`
- 主 Agent 可公开对另一个 Agent 发问
- 目标 Agent 可公开回复
- 聊天窗口能看到完整链路

验收标准：

- `@agent1 看看 @agent2 在干嘛` 能形成公开对话
- 用户能看到 `agent1 -> agent2 -> agent1` 的完整链路

### 第三阶段：稳定性与限制

目标：

- 增加最大深度限制
- 增加超时处理
- 增加非法 mention 校验

验收标准：

- 无穷对话会被截断
- 超时后会有清晰系统提示
- 错误场景不会拖垮整条会话

## 15. 测试建议

### 15.1 构建验证

- `npm run build -w client`
- `npm run build -w server`

### 15.2 前端测试

- `@` 触发 Agent 列表
- Agent 列表滚动
- 键盘上下、回车、Tab 选择
- 鼠标点击选择
- 当前 mode 切换后，候选列表同步切换
- `auto` 模式默认弹 `Claude`

### 15.3 后端测试

- 无 mention 的普通输入
- 单 Agent mention
- 用户 mention 两个 Agent
- Agent 输出 `@agent2 ...` 后是否正确路由
- 目标 Agent 回复后是否能回填给主 Agent
- 最大深度和超时是否生效

## 16. 建议开发顺序

1. 扩展前后端 mention 类型与输入协议
2. 实现前端 `@` Agent 列表与滚动选择
3. 实现单 Agent 定向执行
4. 引入 orchestrator
5. 实现公开 `agent -> agent` 消息路由
6. 为消息增加 sender / target metadata
7. 做深度限制、超时、错误回退

## 17. 第一阶段最小可用版本定义

如果需要先快速落地，建议最小版本定义如下：

- 输入 `@` 时可弹出当前 CLI Agent 列表
- 列表支持滚动
- 用户可选择一个 Agent
- 前端自动拼接 mentions
- 后端按指定 Agent 执行

完成这一版后，再进入“公开 Agent 对 Agent 对话”阶段。
