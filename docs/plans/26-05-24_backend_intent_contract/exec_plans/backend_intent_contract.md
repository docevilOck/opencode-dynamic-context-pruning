# Backend Intent Contract 实现计划

> **给代理型执行者：** 必需子技能：使用 `superpowers:executing-plans` 按任务逐步实现这个计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 将 `compress` 的 backend 模式输入从旧的 `topic + content` 契约改为 `currentTask + retentionHint + content`，让 compact subagent 依据当前任务和保留重点生成摘要。

**架构：** 保留现有 `compress.backend`、独立 backend session、`range` / `message` 双模式和 `CompressionBlock` 落盘流程。改造点集中在 backend 模式的 tool schema、输入归一化、backend 请求类型、prompt 组装和测试断言。

**技术栈：** TypeScript、Node test runner、`@opencode-ai/plugin`、`@opencode-ai/sdk`

---

### 任务 1：锁定 backend 输入契约测试

- [x] backend schema 测试要求 `currentTask` 和 `retentionHint`
- [x] backend 集成测试输入改为 `currentTask + retentionHint + content`
- [x] backend prompt 单测请求改为新字段

### 任务 2：改造 backend 输入类型与归一化层

- [x] `CompressRangeBackendToolArgs` / `CompressMessageBackendToolArgs` 改为新字段
- [x] `BackendBaseRequest` 改为新字段
- [x] `backend-input.ts` 校验并映射 intent 字段

### 任务 3：切换 tool schema 与格式扩展

- [x] range backend schema 改为 `currentTask` / `retentionHint`
- [x] message backend schema 改为 `currentTask` / `retentionHint`
- [x] 不可编辑格式扩展同步更新

### 任务 4：改造 backend prompt 构造与调用参数

- [x] backend 请求传递 `currentTask` / `retentionHint`
- [x] backend prompt 明确 selected messages 是 source material
- [x] backend 单测断言 prompt 文本

### 任务 5：补齐 backend 意图字段的执行期校验

- [x] 缺失 `retentionHint` 时拒绝 range backend 调用
- [x] 缺失 `currentTask` 时拒绝 message backend 调用

### 任务 6：更新文档

- [x] README 英文文档说明新字段契约
- [x] README 中文文档说明新字段契约
- [x] 旧 backend 计划补充 intent contract 说明

### 任务 7：整体验证与证据回填

- [x] 运行 backend 相关测试集
- [x] 运行类型检查
- [x] 回填验证记录

## 验证记录

- 命令：`node --import tsx --test tests/compress-range.test.ts tests/compress-message.test.ts tests/compress-backend.test.ts tests/compress-backend-integration.test.ts`
- 结果摘要：30 个测试通过，0 失败，0 skipped。
- 是否通过：通过
- 未覆盖风险：未调用真实 backend 模型服务，backend 行为由测试桩覆盖。

- 命令：`npm run typecheck`
- 结果摘要：`tsc --noEmit` 退出码 0。
- 是否通过：通过
- 未覆盖风险：仅覆盖 TypeScript 静态类型，不覆盖运行时真实 OpenCode 宿主集成。
