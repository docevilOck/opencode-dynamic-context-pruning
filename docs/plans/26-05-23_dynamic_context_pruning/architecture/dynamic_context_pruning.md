# Dynamic Context Pruning 实现架构

## 目标
- 为当前插件仓库增加一个可选的“压缩专用模型后端”。
- 保留现有 `compress` 工具入口和 `range` / `message` 双模式，让主模型继续决定“压缩哪些消息”。
- 当后端开关开启时，最终摘要不再直接采用主模型传进来的 `summary`，而是由插件自己新开一个独立 session，用你指定的模型去做 compact，再把结果写回现有 `CompressionBlock`。

## 改动范围
- 配置入口：`lib/config.ts`、`dcp.schema.json`
- 压缩执行入口：`lib/compress/range.ts`、`lib/compress/message.ts`
- 共享流水线：`lib/compress/pipeline.ts`
- 新增后端层：
  - `lib/compress/backend.ts`
  - `lib/compress/backend-prompts.ts`
  - `lib/compress/backend-types.ts`
- 状态与展示补充：
  - `lib/state/types.ts`
  - `lib/ui/notification.ts`
  - `README.md`
  - `README.zh-CN.md`

## 不改什么
- 不改 `index.ts` 挂 hook / tool 的插件装配方式。
- 不改 OpenCode 宿主，不依赖宿主提供工具级模型路由。
- 不改 `compress` tool 的名称、权限语义和现有 range/message 参数结构。
- 不把自动 `prune` 链路改造成这次功能的主入口；它只是边界，不是主战场。

## 接入点图
Source: `docs/plans/26-05-23_dynamic_context_pruning/architecture/dynamic_context_pruning.puml`

```text
主模型
  |
  v
compress tool (range / message)
  |
  v
prepareSession()
  |
  v
backend.ts
  |
  v
独立 compact session
  |
  v
指定 provider/model
  |
  v
结构化 summary
  |
  v
applyCompressionState() + finalizeSession()

改造点：
1. 保留现有 compress tool 入口
2. 最终摘要改由独立 compact session 生成
3. 主模型只保留“选目标 ID”职责
```

## 现状
- 当前 `createCompressRangeTool()` 和 `createCompressMessageTool()` 都直接使用主模型工具调用里传进来的 `summary` 文本作为最终摘要来源。
- `prepareSession()` 已经提供了这次改造最重要的前置条件：
  - 从主会话 `session.messages` 拉取原始消息
  - 初始化 `SessionState`
  - 去重与错误清理
  - 构建 `SearchContext`
- `range.ts` 当前在解析区间后，会继续：
  - 校验 placeholder
  - 注入缺失 block summary
  - 拼接保护用户消息、提示词信息、保护工具输出
  - 调 `applyCompressionState()` 写入 block
- `message.ts` 当前也类似，只是粒度变成逐条 message 压缩。
- 所以当前仓库并不缺“压缩执行骨架”，缺的是“单独调用 compact 模型”的后端层。

## 收敛后的目标流程

```text
当前：
主模型判断压缩
-> 传入 summary
-> 插件写入 CompressionBlock
-> 后续用 block summary 替换原始消息

目标：
主模型判断压缩
-> 传入 messageId 或 startId/endId
-> 插件按 ID 提取原始消息
-> 插件启动独立 compact session
-> 指定模型生成 summary
-> 插件写入 CompressionBlock
-> 后续用 block summary 替换原始消息
```

## 核心设计

### 1. 增加压缩后端抽象层
- 新增 `lib/compress/backend.ts` 作为唯一后端入口，例如：
  - `generateCompressionSummary(...)`
- `range.ts` 和 `message.ts` 不再各自直接决定最终摘要来源，而是：
  - 后端关闭时，沿用当前 `entry.summary`
  - 后端开启时，统一调用 `backend.ts`

### 2. 主模型和 compact 模型职责切开
- 主模型继续负责：
  - 什么时候调用 `compress`
  - 选中哪些 `startId/endId` 或 `messageId`
  - 给出 `topic`
- compact 模型负责：
  - 基于插件组装的待压缩内容，生成最终结构化摘要
- 结论：主模型不再是最终摘要真源，只负责提供压缩目标 ID。

### 3. compact 调用必须走独立 session
- 后端开启时，`backend.ts` 必须通过 OpenCode SDK 发起一次独立压缩请求。
- 首选实现是：
  - 新开独立 session
  - 通过 `session.prompt` 指定由 `compress.backend.model` 解析出的 `providerID/modelID`
  - 仅把压缩所需上下文发给该 session
- 如果 SDK 最终不支持显式独立 session，这份实现架构允许退到“等效隔离调用”，但必须明确记录该限制，并在实现里防递归。

### 4. 后端返回结构化结果
- `range` 模式至少返回：
  - `topic`
  - `summary`
- `message` 模式至少返回：
  - `items[]`
  - 每项含 `messageId`、`topic`、`summary`
- 目标是让 `range.ts` / `message.ts` 直接消费结构化结果，而不是从自由文本里做脆弱二次解析。

### 5. 失败策略是“失败即失败”
- 后端关闭：完全兼容当前行为。
- 后端开启且 compact 模型失败：
  - 当前 `compress` 整体失败
  - 不写入新的 `CompressionBlock`
  - 不静默回退到主模型摘要
- 原因很简单：一旦静默回退，用户无法知道最终摘要到底来自谁。

## 主流程
Source: `docs/plans/26-05-23_dynamic_context_pruning/architecture/dynamic_context_pruning.puml`

```text
1. 主模型发起 compress tool 调用
2. 主模型只传压缩目标 ID 和 topic
3. prepareSession() 拉取主会话消息
4. range/message 解析选中的压缩目标
5. 若 backend.enabled=false，沿用当前 entry.summary
6. 若 backend.enabled=true：
7.   backend.ts 组装独立 compact 请求
8.   新开独立 session 或等效隔离调用
9.   用 `compress.backend.model` 解析出的 provider/modelID 执行 session.prompt
10.  获取结构化 summary 结果
11. 用后端 summary 继续现有 protected content / block 写入流程
12. applyCompressionState()
13. finalizeSession()
```

## 如何防止主 agent 继续传 `summary`

这件事不能只靠提示词，要做三层约束：

### 1. tool schema 在 backend 模式下改成“不接收 summary”
- 当前 `range` / `message` schema 都把 `summary` 设成必填。
- 后端开启时，schema 应切成另一版：
  - `range`: `topic + [{ startId, endId }]`
  - `message`: `topic + [{ messageId }]`
- 这样主 agent 在遵守工具 schema 的前提下，就没有地方可以再传 `summary`。

### 2. tool description 明确改写
- `createCompressRangeTool()` / `createCompressMessageTool()` 的描述文本在 backend 模式下要改成：
  - 只提供压缩目标 ID
  - 不要提供 summary
  - summary 由压缩后端模型生成
- 这一步是给模型行为做引导，但不是最终防线。

### 3. 执行期做兜底校验
- 即使 schema 和描述都改了，也要在执行期再挡一次：
  - 如果 backend 开启，但调用参数里仍然出现 `summary`
  - 直接报错
- 这里不保留“忽略并告警”兼容分支，避免协议语义再次变脏。

## 推荐决策
- 对外语义最干净的方案是：
  - backend 关闭：保留现有 schema，`summary` 必填
  - backend 开启：切换到另一套 schema，根本不接受 `summary`
- backend 开启且仍然出现 `summary`：直接 fail fast
- 这样职责最清楚：
  - 主模型只选压缩目标
  - 后端模型负责最终摘要
- 不需要让两个模型同时对 `summary` 负责。

## 模块职责划分

### `lib/compress/pipeline.ts`
- 继续负责通用准备与收尾。
- 这次只补充：
  - 供后端复用的主会话消息与 `SearchContext`
  - 必要时补一个共享的“压缩请求上下文”构造函数
- 不把 SDK prompt 调用直接塞进 `pipeline.ts`。

### `lib/compress/backend.ts`
- 这是本次改造的核心文件。
- 负责：
  - 模式分发
  - 组装后端压缩请求
  - 调 OpenCode SDK
  - 校验结构化结果
  - 返回最终摘要
- 不负责 block 落盘，不负责通知发送。

### `lib/compress/backend-prompts.ts`
- 负责压缩专用提示词构造。
- 明确区分：
  - `range` 单摘要
  - `message` 批量摘要
- 这些提示词不能复用主会话 system prompt，避免把 DCP 自己的宿主提示递归注入到 compact session。

### `lib/compress/range.ts`
- 保留现有：
  - 范围解析
  - placeholder 校验
  - 缺失 block summary 注入
  - 保护内容拼接
  - `applyCompressionState()`
- 新增的唯一关键变更：
  - backend 开启时 schema 不再接收 `summary`
  - 最终 summary 来源从 `backend.ts` 返回值替代 `entry.summary`

### `lib/compress/message.ts`
- 保留现有：
  - 单消息目标解析
  - skipped issue 处理
  - 结果格式化
  - `applyCompressionState()`
- 新增的唯一关键变更：
  - backend 开启时 schema 不再接收 `summary`
  - 一次性批量获取 message summaries，而不是继续信任主模型入参

### `lib/config.ts`
- 新增 `compress.backend` 配置：
  - `enabled`
  - `model`
  - `timeoutMs`
  - `mode`
- 要求：
  - 关闭时模型可缺省
  - 开启时模型必填，格式固定为 `providerID/modelID`

## backend 配置格式

推荐配置：

```json
{
  "compress": {
    "backend": {
      "enabled": true,
      "mode": "session-prompt",
      "timeoutMs": 60000,
      "model": "openai/gpt-5-mini"
    }
  }
}
```

解析规则：
- `compress.backend.model` 使用单字符串格式。
- 以第一个 `/` 作为分隔：
  - 前半段是 `providerID`
  - 后半段全部作为 `modelID`

校验规则：
- `enabled=false` 时，`model` 可不填
- `enabled=true` 时，`model` 必填
- `model` 必须满足 `providerID/modelID` 格式
- `providerID` 和 `modelID` 都不能为空

## 当前仓库里的关键数据结构
- `ToolContext`
  - 位置：`lib/compress/types.ts`
  - 作用：后端层可直接复用 `client/state/logger/config/prompts`
- `SearchContext`
  - 位置：`lib/compress/types.ts`
  - 作用：承载主会话消息、按 ID 检索、旧 block summary 查询
- `CompressionStateInput`
  - 位置：`lib/compress/types.ts`
  - 作用：后端 summary 确认后，仍通过现有输入写入 block
- `CompressionBlock`
  - 位置：`lib/state/types.ts`
  - 作用：仍然是压缩结果的最终落盘形态

## 修改前后对照
Source: `docs/plans/26-05-23_dynamic_context_pruning/architecture/dynamic_context_pruning.puml`

```text
Before
- 主模型选压缩目标
- 主模型直接给最终 summary
- 插件只负责解析、拼接、写 block

After
- 主模型选压缩目标
- 主模型只传目标 ID
- 插件新开独立 compact session
- 指定模型生成最终 summary
- 插件继续按现有方式写 block
```

## 关键约束
- 主模型仍然决定压缩目标，这一点不变。
- backend 开启时，主模型不再提交 `summary` 字段。
- 后端 compact 模型只决定最终摘要，不反向改写原始目标选择。
- `range` 和 `message` 两种模式都必须支持。
- `compress.backend.model` 必须使用 `providerID/modelID` 字符串格式。
- `session.messages` 和 `session.prompt` 是当前默认依赖的 SDK 能力边界。
- 不允许把 compact 结果再送回主会话继续生成摘要，否则会污染上下文并放大递归风险。

## 风险
- SDK 可能没有稳定的“显式新建独立 session”接口，需要退回到等效隔离实现。
- `message` 模式的结构化批量返回如果不稳定，会增加校验和报错处理。
- 后端开启后每次压缩都会多一次模型调用，延迟和费用都会上升。
- 如果 compact 模型和主模型的风格差异过大，block summary 可能出现表达风格跳变。

## 分阶段落地建议
1. 第一阶段：补 `compress.backend` 配置和 `backend.ts` 抽象，不接业务调用。
2. 第二阶段：后端开启时切换 `range` / `message` tool schema，彻底去掉主模型 `summary` 输入。
3. 第三阶段：先接 `range` 模式，验证独立 compact session 路径可用。
4. 第四阶段：接 `message` 模式、批量结构化返回和通知元数据。

## 最低验收
- 能明确看出主改动点在 `lib/compress/*`，不是 `lib/hooks.ts` 自动 prune 链路。
- 能明确看出后端开启后，最终摘要来源变成独立 compact session。
- 能明确看出主模型只负责传压缩目标 ID，不再负责最终摘要。
- 能明确看出 `range` / `message` 双模式都在本次设计范围内。
- 每张图都指向同一个 `.puml` 源文件。
