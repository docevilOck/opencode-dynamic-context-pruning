# Dynamic Context Pruning Implementation Architecture

## Goals
- Add an optional dedicated compression-model backend to the current plugin repository.
- Keep the existing `compress` tool entry point and both `range` / `message` modes, so the primary model still decides which messages should be compressed.
- When the backend switch is enabled, the final summary must no longer come directly from the primary model's `summary` argument. Instead, the plugin should open an independent session, run compact with the configured model, and write the result back into the existing `CompressionBlock`.

## Scope of Changes
- Configuration entry points: `lib/config.ts`, `dcp.schema.json`
- Compression execution entry points: `lib/compress/range.ts`, `lib/compress/message.ts`
- Shared pipeline: `lib/compress/pipeline.ts`
- New backend layer:
  - `lib/compress/backend.ts`
  - `lib/compress/backend-prompts.ts`
  - `lib/compress/backend-types.ts`
- State and presentation updates:
  - `lib/state/types.ts`
  - `lib/ui/notification.ts`
  - `README.md`
  - `README.zh-CN.md`

## What Stays Unchanged
- Do not change the plugin assembly pattern in `index.ts` for hooks and tools.
- Do not modify the OpenCode host and do not depend on host-side per-tool model routing.
- Do not change the `compress` tool name, permission semantics, or the existing range/message parameter model.
- Do not turn the automatic `prune` flow into the main entry point for this feature. It is only a boundary, not the core path.

## Integration Diagram
Source: `docs/plans/26-05-23_dynamic_context_pruning/architecture/dynamic_context_pruning.puml`

```text
Primary model
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
Independent compact session
  |
  v
Selected provider/model
  |
  v
Structured summary
  |
  v
applyCompressionState() + finalizeSession()

Key changes:
1. Keep the existing compress tool entry point
2. Generate the final summary in an independent compact session
3. Limit the primary model to target-ID selection
```

## Current State
- `createCompressRangeTool()` and `createCompressMessageTool()` currently use the `summary` text passed by the primary model tool call as the final summary source.
- `prepareSession()` already provides the most important prerequisites for this change:
  - Pull raw messages from the main session through `session.messages`
  - Initialize `SessionState`
  - Run deduplication and error cleanup
  - Build `SearchContext`
- In `range.ts`, after resolving ranges, the current flow continues with:
  - Placeholder validation
  - Injection of missing block summaries
  - Protected user-message and protected tool-output assembly
  - `applyCompressionState()` to write the block
- `message.ts` behaves similarly, except that compression happens per message.
- So the repository already has the execution skeleton for compression. What is missing is a backend layer that calls a separate compact model.

## Target Flow After Simplification

```text
Current:
Primary model decides to compress
-> passes summary
-> plugin writes CompressionBlock
-> later replaces original messages with block summary

Target:
Primary model decides to compress
-> passes messageId or startId/endId
-> plugin extracts raw messages by ID
-> plugin starts an independent compact session
-> configured model generates summary
-> plugin writes CompressionBlock
-> later replaces original messages with block summary
```

## Core Design

### 1. Add a Compression Backend Abstraction
- Introduce `lib/compress/backend.ts` as the single backend entry point, for example:
  - `generateCompressionSummary(...)`
- `range.ts` and `message.ts` should no longer decide the final summary source on their own:
  - When backend is disabled, keep using `entry.summary`
  - When backend is enabled, route through `backend.ts`

### 2. Separate Primary-Model Responsibility from Compact-Model Responsibility
- The primary model remains responsible for:
  - deciding when to call `compress`
  - selecting `startId/endId` or `messageId`
  - providing `topic`
- The compact model is responsible for:
  - generating the final structured summary from the payload assembled by the plugin
- Conclusion: the primary model is no longer the source of truth for the final summary. It only provides target IDs.

### 3. Compact Calls Must Use an Independent Session
- When backend is enabled, `backend.ts` must launch a separate compression request through the OpenCode SDK.
- Preferred implementation:
  - create a new independent session
  - call `session.prompt` with the `providerID/modelID` parsed from `compress.backend.model`
  - send only the context required for compression to that session
- If the SDK does not provide a stable explicit session-creation path, this architecture may fall back to an equivalent isolated call, but that limitation must be documented clearly and recursion must still be prevented.

### 4. The Backend Must Return Structured Results
- `range` mode should return at least:
  - `topic`
  - `summary`
- `message` mode should return at least:
  - `items[]`
  - each item containing `messageId`, `topic`, and `summary`
- The goal is to let `range.ts` / `message.ts` consume structured results directly instead of doing fragile second-pass parsing on free text.

### 5. Failure Policy: Fail as a Whole
- When backend is disabled, behavior stays fully backward-compatible.
- When backend is enabled and the compact model fails:
  - the entire `compress` operation fails
  - no new `CompressionBlock` is written
  - there is no silent fallback to the primary model summary
- The reason is simple: once silent fallback exists, the user can no longer know where the final summary actually came from.

## Main Flow
Source: `docs/plans/26-05-23_dynamic_context_pruning/architecture/dynamic_context_pruning.puml`

```text
1. The primary model calls the compress tool
2. The primary model only passes target IDs and topic
3. prepareSession() loads the main-session messages
4. range/message resolves the selected compression targets
5. If backend.enabled=false, keep using entry.summary
6. If backend.enabled=true:
7.   backend.ts builds an isolated compact request
8.   Create a new independent session or equivalent isolated call
9.   Run session.prompt with the provider/modelID parsed from `compress.backend.model`
10.  Receive the structured summary result
11. Continue the existing protected-content and block-write flow with the backend summary
12. applyCompressionState()
13. finalizeSession()
```

## How to Prevent the Primary Agent from Still Passing `summary`

This cannot rely on prompt wording alone. It needs three layers of constraints.

### 1. Switch the Tool Schema in Backend Mode So It No Longer Accepts `summary`
- The current `range` / `message` schemas both require `summary`.
- When backend is enabled, the schema should switch to another form:
  - `range`: `topic + [{ startId, endId }]`
  - `message`: `topic + [{ messageId }]`
- With that schema in place, the primary agent has no valid place to send `summary`.

### 2. Rewrite the Tool Description Explicitly
- The description text for `createCompressRangeTool()` / `createCompressMessageTool()` should state, in backend mode:
  - only provide target IDs
  - do not provide summary
  - the summary will be generated by the compression backend model
- This is behavior guidance for the model, but it is not the final line of defense.

### 3. Add a Runtime Guard
- Even after changing the schema and description, execution still needs a hard guard:
  - if backend is enabled and the call still includes `summary`
  - fail immediately
- Do not keep an "ignore and warn" compatibility branch. That would make the protocol dirty again.

## Recommended Decision
- The cleanest external behavior is:
  - backend disabled: keep the current schema and require `summary`
  - backend enabled: switch to a different schema that does not accept `summary` at all
- If backend is enabled and `summary` still appears: fail fast
- This keeps responsibility clear:
  - the primary model selects compression targets
  - the backend model produces the final summary
- There is no need to let both models share responsibility for `summary`.

## Module Responsibilities

### `lib/compress/pipeline.ts`
- Keep handling the common preparation and finalization steps.
- Only add:
  - main-session message access and `SearchContext` reuse for the backend
  - a shared compression-request context builder if needed
- Do not place direct SDK prompt calls inside `pipeline.ts`.

### `lib/compress/backend.ts`
- This is the core file for the change.
- Responsibilities:
  - mode dispatch
  - backend compression request assembly
  - OpenCode SDK invocation
  - structured-result validation
  - returning the final summary
- It should not write blocks and should not send notifications.

### `lib/compress/backend-prompts.ts`
- Responsible for compact-specific prompt construction.
- Must clearly separate:
  - single-summary `range`
  - batch-summary `message`
- These prompts must not reuse the primary session system prompt, otherwise DCP host prompts may be recursively injected into the compact session.

### `lib/compress/range.ts`
- Keep the existing responsibilities:
  - range resolution
  - placeholder validation
  - missing block-summary injection
  - protected content assembly
  - `applyCompressionState()`
- Add only one key behavior change:
  - in backend mode, the schema no longer accepts `summary`
  - the final summary source becomes the return value from `backend.ts` instead of `entry.summary`

### `lib/compress/message.ts`
- Keep the existing responsibilities:
  - per-message target resolution
  - skipped-issue handling
  - result formatting
  - `applyCompressionState()`
- Add only one key behavior change:
  - in backend mode, the schema no longer accepts `summary`
  - fetch message summaries in batch instead of trusting the primary model input

### `lib/config.ts`
- Add `compress.backend` configuration:
  - `enabled`
  - `model`
  - `timeoutMs`
  - `mode`
- Requirements:
  - when disabled, the model may be omitted
  - when enabled, the model is required and must use `providerID/modelID`

## Backend Configuration Format

Recommended configuration:

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

Parsing rules:
- `compress.backend.model` uses a single string.
- Split on the first `/`:
  - the prefix is `providerID`
  - the rest is the full `modelID`

Validation rules:
- when `enabled=false`, `model` may be omitted
- when `enabled=true`, `model` is required
- `model` must satisfy the `providerID/modelID` format
- neither `providerID` nor `modelID` may be empty

## Key Data Structures in the Current Repository
- `ToolContext`
  - location: `lib/compress/types.ts`
  - purpose: lets the backend reuse `client/state/logger/config/prompts` directly
- `SearchContext`
  - location: `lib/compress/types.ts`
  - purpose: carries main-session messages, ID-based lookup, and previous block-summary lookup
- `CompressionStateInput`
  - location: `lib/compress/types.ts`
  - purpose: even after backend summary resolution, block writing still uses the existing input shape
- `CompressionBlock`
  - location: `lib/state/types.ts`
  - purpose: remains the final persisted representation of compression output

## Before / After Comparison
Source: `docs/plans/26-05-23_dynamic_context_pruning/architecture/dynamic_context_pruning.puml`

```text
Before
- The primary model selects compression targets
- The primary model directly provides the final summary
- The plugin only resolves, assembles, and writes the block

After
- The primary model selects compression targets
- The primary model only passes target IDs
- The plugin opens an independent compact session
- The configured model generates the final summary
- The plugin continues writing the block through the existing path
```

## Key Constraints
- The primary model still decides compression targets. That does not change.
- When backend is enabled, the primary model must no longer submit a `summary` field.
- The compact backend model only decides the final summary. It must not rewrite the original target selection.
- Both `range` and `message` modes must be supported.
- `compress.backend.model` must use the `providerID/modelID` string format.
- `session.messages` and `session.prompt` are the current default SDK capability boundary.
- The compact result must not be sent back into the primary session for further summary generation, otherwise context pollution and recursion risk will increase.

## Risks
- The SDK may not provide a stable explicit "create independent session" interface, forcing a fallback to an equivalent isolated implementation.
- If batch structured output in `message` mode is unstable, validation and error handling will become more complex.
- With backend enabled, every compression operation adds one more model call, which increases both latency and cost.
- If the compact model and primary model have very different styles, compressed block summaries may show abrupt tone shifts.

## Suggested Rollout by Phase
1. Phase 1: add `compress.backend` config and the `backend.ts` abstraction, without wiring it into business execution yet.
2. Phase 2: switch the `range` / `message` tool schemas when backend is enabled, so primary-model `summary` input is removed completely.
3. Phase 3: wire up `range` mode first and validate the independent compact-session path.
4. Phase 4: wire up `message` mode, batch structured results, and notification metadata.

## Minimum Acceptance Criteria
- It must be obvious that the main changes live under `lib/compress/*`, not in the automatic prune path under `lib/hooks.ts`.
- It must be obvious that, when backend is enabled, the final summary source becomes an independent compact session.
- It must be obvious that the primary model only passes compression target IDs and no longer owns the final summary.
- It must be obvious that both `range` and `message` modes are within the scope of this design.
- Every diagram must point to the same `.puml` source file.
