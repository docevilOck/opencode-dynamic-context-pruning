# Compress Backend Model Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 DCP 的 `compress` 工具增加可选的压缩专用模型后端，使后端开启时主模型只传压缩目标 ID，插件通过独立 compact session 调用指定模型生成最终 summary。

**Architecture:** 保留现有 `range` / `message` 压缩入口、`prepareSession()` 流水线和 `CompressionBlock` 落盘逻辑。新增 `lib/compress/backend.ts` 作为唯一后端调用入口；当 `compress.backend.enabled=true` 时，`compress` 工具 schema 切换为不接收 `summary` 的版本，工具执行阶段根据 `messageId` 或 `startId/endId` 从主会话提取内容，启动独立 compact session，用 `compress.backend.model` 指定的模型生成结构化摘要，再继续现有写 block 流程。

**Tech Stack:** TypeScript、`@opencode-ai/plugin`、`@opencode-ai/sdk`、Node test runner、Prettier、现有 DCP `compress/state/prompt` 基础设施

---

### Task 1: 固化 SDK 与配置事实

**Files:**
- Modify: `docs/plans/2026-05-23-compress-backend-model.md`
- Modify: `package.json`

**Step 1: 安装依赖并确认基线**

Run: `npm install`
Expected: 依赖安装完成，无阻断错误

**Step 2: 跑一次类型检查确认当前基线可用**

Run: `npm run typecheck`
Expected: PASS

**Step 3: 核对 SDK 能力并把事实回填到计划末尾**

需要核对：
- `ctx.client.session.messages(...)` 的真实返回体
- `ctx.client.session.prompt(...)` 的真实参数结构
- 是否存在显式新建 session 的公开接口；若没有，是否能用等效隔离调用实现

在计划文档末尾补一个 `## 接口事实补充` 小节，写清：
- `session.messages` 的调用形态
- `session.prompt` 指定模型的真实字段路径
- “独立 session”是否存在原生 API；没有的话准备走什么替代路径

**Step 4: 提交**

```bash
git add package.json docs/plans/2026-05-23-compress-backend-model.md
git commit -m "chore: document compress backend sdk facts"
```

### Task 2: 为 backend 配置补 failing tests

**Files:**
- Create: `tests/config-backend.test.ts`
- Modify: `lib/config.ts`
- Modify: `dcp.schema.json`

**Step 1: 写配置失败用例，覆盖关闭/开启/非法格式**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { validateConfigTypes } from "../lib/config"

test("compress backend model is optional when backend is disabled", () => {
  const errors = validateConfigTypes({
    compress: {
      backend: {
        enabled: false,
      },
    },
  })

  assert.deepEqual(errors, [])
})

test("compress backend model is required when backend is enabled", () => {
  const errors = validateConfigTypes({
    compress: {
      backend: {
        enabled: true,
      },
    },
  })

  assert.ok(errors.some((entry) => entry.key === "compress.backend.model"))
})

test("compress backend model must use provider/modelID format", () => {
  const errors = validateConfigTypes({
    compress: {
      backend: {
        enabled: true,
        model: "gpt-5-mini",
      },
    },
  })

  assert.ok(errors.some((entry) => entry.key === "compress.backend.model"))
})
```

**Step 2: 跑测试确认当前失败**

Run: `node --import tsx --test tests/config-backend.test.ts`
Expected: FAIL，提示 `compress.backend` 尚未定义或校验未实现

**Step 3: 提交**

```bash
git add tests/config-backend.test.ts
git commit -m "test: add compress backend config coverage"
```

### Task 3: 实现 `compress.backend` 配置结构

**Files:**
- Modify: `lib/config.ts`
- Modify: `dcp.schema.json`
- Test: `tests/config-backend.test.ts`

**Step 1: 在 `lib/config.ts` 添加 backend 类型**

```ts
export interface CompressBackendConfig {
  enabled: boolean
  mode: "session-prompt"
  timeoutMs: number
  model?: string
}
```

并把它挂到：

```ts
export interface CompressConfig {
  ...
  backend: CompressBackendConfig
}
```

**Step 2: 增加默认值**

```ts
backend: {
  enabled: false,
  mode: "session-prompt",
  timeoutMs: 60000,
}
```

**Step 3: 扩展配置 key 白名单和类型校验**

需要补齐这些 key：
- `compress.backend`
- `compress.backend.enabled`
- `compress.backend.mode`
- `compress.backend.timeoutMs`
- `compress.backend.model`

校验要求：
- `enabled=true` 时，`model` 必填
- `model` 必须满足 `providerID/modelID`
- 只按第一个 `/` 切开
- `timeoutMs` 必须是正整数
- `mode` 初版只允许 `session-prompt`

**Step 4: 在 `dcp.schema.json` 补 schema**

至少包含：

```json
"backend": {
  "type": "object",
  "properties": {
    "enabled": { "type": "boolean" },
    "mode": { "type": "string", "enum": ["session-prompt"] },
    "timeoutMs": { "type": "integer", "minimum": 1 },
    "model": { "type": "string" }
  }
}
```

**Step 5: 跑测试确认通过**

Run: `node --import tsx --test tests/config-backend.test.ts`
Expected: PASS

**Step 6: 跑类型检查**

Run: `npm run typecheck`
Expected: PASS

**Step 7: 提交**

```bash
git add lib/config.ts dcp.schema.json tests/config-backend.test.ts
git commit -m "feat: add compress backend config"
```

### Task 4: 为 backend model 解析补单测

**Files:**
- Create: `tests/compress-backend-types.test.ts`
- Create: `lib/compress/backend-types.ts`

**Step 1: 写解析器失败用例**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { parseBackendModelRef } from "../lib/compress/backend-types"

test("parseBackendModelRef splits provider and model on first slash", () => {
  assert.deepEqual(parseBackendModelRef("openai/gpt-5-mini"), {
    providerID: "openai",
    modelID: "gpt-5-mini",
  })
})

test("parseBackendModelRef keeps remaining slashes in model id", () => {
  assert.deepEqual(parseBackendModelRef("provider/family/model"), {
    providerID: "provider",
    modelID: "family/model",
  })
})

test("parseBackendModelRef rejects missing slash", () => {
  assert.throws(() => parseBackendModelRef("gpt-5-mini"))
})
```

**Step 2: 跑测试确认失败**

Run: `node --import tsx --test tests/compress-backend-types.test.ts`
Expected: FAIL，提示模块或导出不存在

**Step 3: 最小实现解析器和共享类型**

```ts
export interface BackendModelRef {
  providerID: string
  modelID: string
}

export function parseBackendModelRef(input: string): BackendModelRef {
  const index = input.indexOf("/")
  if (index <= 0 || index === input.length - 1) {
    throw new Error("compress.backend.model must use providerID/modelID format")
  }

  return {
    providerID: input.slice(0, index),
    modelID: input.slice(index + 1),
  }
}
```

**Step 4: 跑测试确认通过**

Run: `node --import tsx --test tests/compress-backend-types.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add lib/compress/backend-types.ts tests/compress-backend-types.test.ts
git commit -m "feat: add compress backend model ref parser"
```

### Task 5: 为 backend schema 切换补 failing tests

**Files:**
- Modify: `tests/compress-range.test.ts`
- Modify: `tests/compress-message.test.ts`
- Modify: `lib/compress/range.ts`
- Modify: `lib/compress/message.ts`

**Step 1: 在 `compress-range` 测试里补一条 backend 开启时不接受 `summary`**

```ts
test("range tool schema omits summary when backend is enabled", async () => {
  const tool = createCompressRangeTool(makeToolContext({
    compress: {
      backend: {
        enabled: true,
        mode: "session-prompt",
        timeoutMs: 60000,
        model: "openai/gpt-5-mini",
      },
    },
  }))

  const content = String(tool.description ?? "")
  assert.ok(content.includes("startId"))
  assert.ok(content.includes("endId"))
  assert.ok(!content.includes("Complete technical summary replacing all content in range"))
})
```

**Step 2: 在 `compress-message` 测试里补一条 backend 开启时不接受 `summary`**

```ts
test("message tool schema omits summary when backend is enabled", async () => {
  const tool = createCompressMessageTool(makeToolContext({
    compress: {
      backend: {
        enabled: true,
        mode: "session-prompt",
        timeoutMs: 60000,
        model: "openai/gpt-5-mini",
      },
    },
  }))

  const content = String(tool.description ?? "")
  assert.ok(content.includes("messageId"))
  assert.ok(!content.includes("Complete technical summary replacing that one message"))
})
```

**Step 3: 跑这两组测试确认失败**

Run: `node --import tsx --test tests/compress-range.test.ts tests/compress-message.test.ts`
Expected: FAIL，schema 仍然包含 `summary`

**Step 4: 提交**

```bash
git add tests/compress-range.test.ts tests/compress-message.test.ts
git commit -m "test: cover backend schema switching"
```

### Task 6: 在 tool 层实现 backend schema 切换

**Files:**
- Modify: `lib/compress/range.ts`
- Modify: `lib/compress/message.ts`
- Modify: `lib/compress/types.ts`
- Test: `tests/compress-range.test.ts`
- Test: `tests/compress-message.test.ts`

**Step 1: 为 backend 开启时新增参数类型**

在 `lib/compress/types.ts` 补：

```ts
export interface CompressRangeBackendEntry {
  startId: string
  endId: string
}

export interface CompressRangeBackendToolArgs {
  topic: string
  content: CompressRangeBackendEntry[]
}

export interface CompressMessageBackendEntry {
  messageId: string
}

export interface CompressMessageBackendToolArgs {
  topic: string
  content: CompressMessageBackendEntry[]
}
```

**Step 2: 在 `range.ts` 根据 `ctx.config.compress.backend.enabled` 选择 schema**

要求：
- backend 关闭：沿用旧 schema
- backend 开启：返回不含 `summary` 的 schema

**Step 3: 在 `message.ts` 做相同切换**

要求相同。

**Step 4: backend 开启时如果输入里还带 `summary` 直接抛错**

在 `execute()` 开头显式检查原始 `args`：

```ts
if (ctx.config.compress.backend.enabled) {
  const hasSummary = Array.isArray((args as any).content) &&
    (args as any).content.some((item: any) => "summary" in item)

  if (hasSummary) {
    throw new Error("compress backend mode does not accept summary input")
  }
}
```

**Step 5: 跑测试确认通过**

Run: `node --import tsx --test tests/compress-range.test.ts tests/compress-message.test.ts`
Expected: PASS

**Step 6: 提交**

```bash
git add lib/compress/types.ts lib/compress/range.ts lib/compress/message.ts tests/compress-range.test.ts tests/compress-message.test.ts
git commit -m "feat: switch compress schemas in backend mode"
```

### Task 7: 为 backend 调用入口补 failing tests

**Files:**
- Create: `tests/compress-backend.test.ts`
- Create: `lib/compress/backend.ts`
- Create: `lib/compress/backend-prompts.ts`

**Step 1: 写 backend 单测，覆盖关闭、开启、结构错误、超时**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { generateCompressionSummary } from "../lib/compress/backend"

test("returns undefined when backend is disabled", async () => {
  const result = await generateCompressionSummary({
    enabled: false,
  } as any)

  assert.equal(result, undefined)
})

test("uses configured model when backend is enabled", async () => {
  let received: any
  const client = {
    session: {
      prompt: async (input: any) => {
        received = input
        return {
          summary: "backend summary",
          topic: "backend topic",
        }
      },
    },
  }

  await generateCompressionSummary({
    client,
    backend: {
      enabled: true,
      mode: "session-prompt",
      timeoutMs: 60000,
      model: "openai/gpt-5-mini",
    },
    mode: "range",
    topic: "Auth cleanup",
    selectedMessages: [],
  } as any)

  assert.equal(received.body.model.providerID, "openai")
  assert.equal(received.body.model.modelID, "gpt-5-mini")
})
```

**Step 2: 跑测试确认失败**

Run: `node --import tsx --test tests/compress-backend.test.ts`
Expected: FAIL，模块或导出不存在

**Step 3: 提交**

```bash
git add tests/compress-backend.test.ts
git commit -m "test: add compress backend execution coverage"
```

### Task 8: 实现 backend 调用抽象

**Files:**
- Create: `lib/compress/backend.ts`
- Create: `lib/compress/backend-prompts.ts`
- Modify: `lib/compress/backend-types.ts`
- Test: `tests/compress-backend.test.ts`

**Step 1: 在 `backend-types.ts` 补请求/响应类型**

至少补：
- `BackendRangeRequest`
- `BackendMessageRequest`
- `BackendSummaryResult`

**Step 2: 在 `backend-prompts.ts` 提供两套提示词构造函数**

至少包含：
- `buildRangeBackendPrompt(...)`
- `buildMessageBackendPrompt(...)`

要求：
- 只描述压缩任务
- 不复用主会话 DCP system prompt
- 明确要求结构化输出

**Step 3: 在 `backend.ts` 写最小实现**

要求：
- backend 关闭时返回 `undefined`
- backend 开启时：
  - 解析 `compress.backend.model`
  - 调 `client.session.prompt(...)`
  - 指定 `body.model.providerID/modelID`
  - 传入模式对应 prompt
  - 校验返回结构

**Step 4: 跑测试确认通过**

Run: `node --import tsx --test tests/compress-backend.test.ts`
Expected: PASS

**Step 5: 跑类型检查**

Run: `npm run typecheck`
Expected: PASS

**Step 6: 提交**

```bash
git add lib/compress/backend.ts lib/compress/backend-prompts.ts lib/compress/backend-types.ts tests/compress-backend.test.ts
git commit -m "feat: add compress backend session prompt integration"
```

### Task 9: 接入 range 模式后端摘要生成

**Files:**
- Modify: `lib/compress/range.ts`
- Modify: `lib/compress/pipeline.ts`
- Test: `tests/compress-range.test.ts`
- Create: `tests/compress-backend-integration.test.ts`

**Step 1: 为 range 接入 backend 调用**

改造目标：
- backend 关闭：保持现状，仍用 `entry.summary`
- backend 开启：在完成 `resolveRanges()` 后，把选中消息和 block 上下文交给 `generateCompressionSummary(...)`

**Step 2: 写一条集成测试，确认最终 block summary 来自 backend**

```ts
test("range mode uses backend summary instead of primary model summary", async () => {
  // 断言写入 block 的 summary 是 backend 返回值，而不是 tool 输入里的 summary
})
```

**Step 3: 跑 range 测试确认失败**

Run: `node --import tsx --test tests/compress-range.test.ts tests/compress-backend-integration.test.ts`
Expected: FAIL，仍然写入原始 `summary`

**Step 4: 最小实现改造**

实现要求：
- backend 返回摘要后，再进入：
  - `appendProtectedUserMessages()`
  - `appendProtectedPromptInfo()`
  - `appendProtectedTools()`
  - `appendMissingBlockSummaries()`

**Step 5: 跑测试确认通过**

Run: `node --import tsx --test tests/compress-range.test.ts tests/compress-backend-integration.test.ts`
Expected: PASS

**Step 6: 提交**

```bash
git add lib/compress/range.ts lib/compress/pipeline.ts tests/compress-range.test.ts tests/compress-backend-integration.test.ts
git commit -m "feat: use backend summary in range compression"
```

### Task 10: 接入 message 模式后端摘要生成

**Files:**
- Modify: `lib/compress/message.ts`
- Test: `tests/compress-message.test.ts`
- Modify: `tests/compress-backend-integration.test.ts`

**Step 1: 为 message 接入 backend 批量摘要**

改造目标：
- backend 开启时，不再使用 `content[].summary`
- 由 backend 一次性返回 `messageId/topic/summary` 列表

**Step 2: 写集成测试**

```ts
test("message mode uses backend generated summaries", async () => {
  // 断言每个 block 的 summary 都来自 backend 返回值
})

test("message mode rejects mismatched backend message ids", async () => {
  // backend 返回的 messageId 集不完整时直接报错
})
```

**Step 3: 跑测试确认失败**

Run: `node --import tsx --test tests/compress-message.test.ts tests/compress-backend-integration.test.ts`
Expected: FAIL

**Step 4: 最小实现改造**

实现要求：
- backend 返回的 `messageId` 集必须和输入目标集完全一致
- 不一致直接抛错

**Step 5: 跑测试确认通过**

Run: `node --import tsx --test tests/compress-message.test.ts tests/compress-backend-integration.test.ts`
Expected: PASS

**Step 6: 提交**

```bash
git add lib/compress/message.ts tests/compress-message.test.ts tests/compress-backend-integration.test.ts
git commit -m "feat: use backend summary in message compression"
```

### Task 11: 补通知与文档

**Files:**
- Modify: `lib/ui/notification.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Step 1: 补通知元数据展示**

要求：
- backend 开启且有模型信息时，在通知文本或 metadata 中体现 compact 模型来源

**Step 2: 更新 README 文档**

至少补：
- backend 配置示例
- `model` 使用 `providerID/modelID`
- backend 模式下主模型不传 `summary`
- backend 开启会额外多一次模型调用
- backend 模式失败即失败

**Step 3: 跑格式检查**

Run: `npm run format:check`
Expected: PASS

**Step 4: 提交**

```bash
git add lib/ui/notification.ts README.md README.zh-CN.md
git commit -m "docs: describe compress backend model mode"
```

### Task 12: 全量验证与收口

**Files:**
- Modify: 必要时回补前述文件

**Step 1: 跑类型检查**

Run: `npm run typecheck`
Expected: PASS

**Step 2: 跑全量测试**

Run: `npm run test`
Expected: PASS

**Step 3: 跑格式检查**

Run: `npm run format:check`
Expected: PASS

**Step 4: 记录验证证据**

在本计划文档末尾补：
- 命令
- 结果摘要
- 是否通过
- 未覆盖风险

**Step 5: 提交**

```bash
git add docs/plans/2026-05-23-compress-backend-model.md
git commit -m "chore: record compress backend verification evidence"
```

## 接口事实补充

- 当前仓库使用的 SDK v1 调用形态中，`session.messages` 通过 `client.session.messages({ path: { id: sessionId } })` 调用；类型定义 `SessionMessagesData` 对应 `path.id`、可选 `query.directory` / `query.limit`，返回 `200: Array<{ info: Message; parts: Array<Part> }>`。仓库已有 `lib/compress/search.ts` 用 `response?.data || response` 兼容包裹/直返两种运行时形态。
- `session.prompt` 通过 `client.session.prompt({ path: { id: sessionId }, body: { parts, model, agent?, noReply?, system?, tools? } })` 调用；指定模型字段路径是 `body.model.providerID` 和 `body.model.modelID`。现有 `lib/ui/notification.ts` 已按这个结构发送 ignored message。
- SDK v1 暴露原生 `client.session.create({ body?: { parentID?: string; title?: string }, query?: { directory?: string } })`，返回 `Session`；因此 backend compact 初版可以创建独立 session，再对该 session 调 `session.prompt`，用 `compress.backend.model` 解析出的 `{ providerID, modelID }` 指定压缩模型。
