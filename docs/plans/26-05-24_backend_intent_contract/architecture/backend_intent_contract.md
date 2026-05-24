# Backend Intent Contract 补强架构

本补强文档用于收敛 `compress.backend.enabled=true` 时主 agent 与 compact subagent 之间的传参语义，避免后端摘要变成通用总结，或把仍在推进的当前任务误解为被压缩消息的主题。

## 目标

- backend 模式下，主 agent 继续负责选择压缩目标。
- backend 模式下，主 agent 同时提供 `currentTask` 和 `retentionHint`。
- compact subagent 根据 `currentTask`、`retentionHint` 和选中的原始消息生成结构化摘要。
- `topic` 不再作为 backend tool 输入字段使用。

## 边界图

Source: `docs/plans/26-05-24_backend_intent_contract/architecture/backend_intent_contract.puml`

```text
Main agent
  |
  | currentTask + retentionHint + target IDs
  v
compress tool
  |
  | selected messages + intent
  v
backend.ts
  |
  | constrained prompt
  v
Compact session
  |
  | structured summary
  v
CompressionBlock
```

## 接入点

- `lib/compress/types.ts`：backend tool args 使用 `currentTask`、`retentionHint` 和 `content`。
- `lib/compress/backend-input.ts`：执行期校验两个 intent 字段，并把内部 batch topic 映射为 `currentTask`。
- `lib/compress/range.ts` / `lib/compress/message.ts`：backend schema 暴露新字段，backend 调用传递新字段。
- `lib/compress/backend-prompts.ts`：prompt 明确 selected messages 是 source material，不能把 `currentTask` 当作源消息摘要。

## 验收标准

- backend 模式 schema 中 `currentTask` 和 `retentionHint` 均为必填。
- backend 模式继续拒绝主 agent 传入 `summary`。
- compact subagent 的 prompt 明确知道 `currentTask` 是当前继续推进的任务。
- compact subagent 的 prompt 明确知道 `retentionHint` 是保留优先级。
