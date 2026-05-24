import assert from "node:assert/strict"
import test from "node:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdirSync } from "node:fs"
import { createCompressRangeTool } from "../lib/compress/range"
import { createCompressMessageTool } from "../lib/compress/message"
import { createSessionState, type WithParts } from "../lib/state"
import type { PluginConfig } from "../lib/config"
import { Logger } from "../lib/logger"

const testDataHome = join(tmpdir(), `opencode-dcp-backend-integration-${process.pid}`)
const testConfigHome = join(tmpdir(), `opencode-dcp-backend-integration-config-${process.pid}`)

process.env.XDG_DATA_HOME = testDataHome
process.env.XDG_CONFIG_HOME = testConfigHome

mkdirSync(testDataHome, { recursive: true })
mkdirSync(testConfigHome, { recursive: true })

function buildConfig(mode: "range" | "message"): PluginConfig {
    return {
        enabled: true,
        debug: false,
        pruneNotification: "off",
        pruneNotificationType: "chat",
        commands: {
            enabled: true,
            protectedTools: [],
        },
        manualMode: {
            enabled: false,
            automaticStrategies: true,
        },
        turnProtection: {
            enabled: false,
            turns: 4,
        },
        experimental: {
            allowSubAgents: false,
            customPrompts: false,
        },
        protectedFilePatterns: [],
        compress: {
            mode,
            permission: "allow",
            showCompression: false,
            summaryBuffer: true,
            maxContextLimit: 150000,
            minContextLimit: 50000,
            nudgeFrequency: 5,
            iterationNudgeThreshold: 15,
            nudgeForce: "soft",
            protectedTools: [],
            protectTags: false,
            protectUserMessages: false,
            backend: {
                enabled: true,
                mode: "session-prompt",
                timeoutMs: 60000,
                model: "openai/gpt-5-mini",
            },
        },
        strategies: {
            deduplication: {
                enabled: true,
                protectedTools: [],
            },
            purgeErrors: {
                enabled: true,
                turns: 4,
                protectedTools: [],
            },
        },
    }
}

function textPart(messageID: string, sessionID: string, id: string, text: string) {
    return {
        id,
        messageID,
        sessionID,
        type: "text" as const,
        text,
    }
}

function buildMessages(sessionID: string): WithParts[] {
    return [
        {
            info: {
                id: "msg-user-1",
                role: "user",
                sessionID,
                agent: "assistant",
                model: {
                    providerID: "anthropic",
                    modelID: "claude-test",
                },
                time: { created: 1 },
            } as WithParts["info"],
            parts: [textPart("msg-user-1", sessionID, "part-1", "Investigate the issue")],
        },
        {
            info: {
                id: "msg-assistant-1",
                role: "assistant",
                sessionID,
                agent: "assistant",
                time: { created: 2 },
            } as WithParts["info"],
            parts: [textPart("msg-assistant-1", sessionID, "part-2", "I mapped the code path")],
        },
    ]
}

function buildClient(rawMessages: WithParts[], backendText: string) {
    return {
        session: {
            messages: async ({ path }: any) => {
                if (path.id.startsWith("ses_backend_")) {
                    return { data: [] }
                }
                return { data: rawMessages }
            },
            get: async () => ({ data: { parentID: null } }),
            create: async () => ({ data: { id: `ses_backend_${Date.now()}` } }),
            prompt: async () => ({
                data: {
                    info: { id: "msg-backend", role: "assistant" },
                    parts: [{ type: "text", text: backendText }],
                },
            }),
        },
    }
}

test("range mode uses backend summary instead of primary model summary", async () => {
    const sessionID = `ses_range_backend_${Date.now()}`
    const rawMessages = buildMessages(sessionID)
    const state = createSessionState()

    const tool = createCompressRangeTool({
        client: buildClient(rawMessages, '{"summary":"backend generated range summary"}'),
        state,
        logger: new Logger(false),
        config: buildConfig("range"),
        prompts: {
            reload() {},
            getRuntimePrompts() {
                return { compressRange: "", compressMessage: "" }
            },
        },
    } as any)

    await tool.execute(
        {
            currentTask: "Continue investigating the issue",
            retentionHint: "Keep code paths, constraints, and unresolved questions",
            content: [
                {
                    startId: "m0001",
                    endId: "m0002",
                },
            ],
        },
        {
            ask: async () => {},
            metadata: () => {},
            sessionID,
            messageID: "msg-compress-backend-range",
        },
    )

    const block = Array.from(state.prune.messages.blocksById.values())[0]
    assert.match(block?.summary || "", /backend generated range summary/)
    assert.doesNotMatch(block?.summary || "", /primary model/)
})

test("message mode uses backend generated summaries", async () => {
    const sessionID = `ses_message_backend_${Date.now()}`
    const rawMessages = buildMessages(sessionID)
    const state = createSessionState()

    const tool = createCompressMessageTool({
        client: buildClient(
            rawMessages,
            '{"summaries":[{"messageId":"m0001","topic":"Backend user","summary":"backend user summary"},{"messageId":"m0002","topic":"Backend assistant","summary":"backend assistant summary"}]}',
        ),
        state,
        logger: new Logger(false),
        config: buildConfig("message"),
        prompts: {
            reload() {},
            getRuntimePrompts() {
                return { compressRange: "", compressMessage: "" }
            },
        },
    } as any)

    await tool.execute(
        {
            currentTask: "Continue cleanup follow-up",
            retentionHint: "Keep user intent and assistant findings",
            content: [{ messageId: "m0001" }, { messageId: "m0002" }],
        },
        {
            ask: async () => {},
            metadata: () => {},
            sessionID,
            messageID: "msg-compress-backend-message",
        },
    )

    const blocks = Array.from(state.prune.messages.blocksById.values()).sort(
        (left, right) => left.blockId - right.blockId,
    )
    assert.match(blocks[0]?.summary || "", /backend user summary/)
    assert.match(blocks[1]?.summary || "", /backend assistant summary/)
    assert.equal(blocks[0]?.topic, "Backend user")
    assert.equal(blocks[1]?.topic, "Backend assistant")
})

test("message mode rejects mismatched backend message ids", async () => {
    const sessionID = `ses_message_backend_mismatch_${Date.now()}`
    const rawMessages = buildMessages(sessionID)
    const state = createSessionState()

    const tool = createCompressMessageTool({
        client: buildClient(
            rawMessages,
            '{"summaries":[{"messageId":"m0001","topic":"Backend user","summary":"backend user summary"}]}',
        ),
        state,
        logger: new Logger(false),
        config: buildConfig("message"),
        prompts: {
            reload() {},
            getRuntimePrompts() {
                return { compressRange: "", compressMessage: "" }
            },
        },
    } as any)

    await assert.rejects(
        tool.execute(
            {
                currentTask: "Continue cleanup follow-up",
                retentionHint: "Keep user intent and assistant findings",
                content: [{ messageId: "m0001" }, { messageId: "m0002" }],
            },
            {
                ask: async () => {},
                metadata: () => {},
                sessionID,
                messageID: "msg-compress-backend-message-mismatch",
            },
        ),
        /backend summaries must match requested message ids/,
    )
})

test("range mode rejects manual summaries when backend is enabled", async () => {
    const sessionID = `ses_range_backend_manual_summary_${Date.now()}`
    const rawMessages = buildMessages(sessionID)
    const state = createSessionState()

    const tool = createCompressRangeTool({
        client: buildClient(rawMessages, '{"summary":"backend generated range summary"}'),
        state,
        logger: new Logger(false),
        config: buildConfig("range"),
        prompts: {
            reload() {},
            getRuntimePrompts() {
                return { compressRange: "", compressMessage: "" }
            },
        },
    } as any)

    await assert.rejects(
        tool.execute(
            {
                currentTask: "Continue investigating the issue",
                retentionHint: "Keep code paths, constraints, and unresolved questions",
                content: [
                    {
                        startId: "m0001",
                        endId: "m0002",
                        summary: "manual summary should be rejected",
                    },
                ],
            } as any,
            {
                ask: async () => {},
                metadata: () => {},
                sessionID,
                messageID: "msg-compress-backend-range-manual-summary",
            },
        ),
        /compress backend mode does not accept summary input/,
    )
})

test("range mode rejects missing retention hint when backend is enabled", async () => {
    const sessionID = `ses_range_backend_missing_hint_${Date.now()}`
    const rawMessages = buildMessages(sessionID)
    const state = createSessionState()

    const tool = createCompressRangeTool({
        client: buildClient(rawMessages, '{"summary":"backend generated range summary"}'),
        state,
        logger: new Logger(false),
        config: buildConfig("range"),
        prompts: {
            reload() {},
            getRuntimePrompts() {
                return { compressRange: "", compressMessage: "" }
            },
        },
    } as any)

    await assert.rejects(
        tool.execute(
            {
                currentTask: "Continue investigating the issue",
                content: [{ startId: "m0001", endId: "m0002" }],
            } as any,
            {
                ask: async () => {},
                metadata: () => {},
                sessionID,
                messageID: "msg-compress-backend-range-missing-hint",
            },
        ),
        /compress backend mode requires non-empty retentionHint/,
    )
})

test("message mode rejects manual summaries when backend is enabled", async () => {
    const sessionID = `ses_message_backend_manual_summary_${Date.now()}`
    const rawMessages = buildMessages(sessionID)
    const state = createSessionState()

    const tool = createCompressMessageTool({
        client: buildClient(
            rawMessages,
            '{"summaries":[{"messageId":"m0001","topic":"Backend user","summary":"backend user summary"}]}',
        ),
        state,
        logger: new Logger(false),
        config: buildConfig("message"),
        prompts: {
            reload() {},
            getRuntimePrompts() {
                return { compressRange: "", compressMessage: "" }
            },
        },
    } as any)

    await assert.rejects(
        tool.execute(
            {
                currentTask: "Continue cleanup follow-up",
                retentionHint: "Keep user intent and assistant findings",
                content: [
                    {
                        messageId: "m0001",
                        topic: "manual topic",
                        summary: "manual summary should be rejected",
                    },
                ],
            } as any,
            {
                ask: async () => {},
                metadata: () => {},
                sessionID,
                messageID: "msg-compress-backend-message-manual-summary",
            },
        ),
        /compress backend mode does not accept summary input/,
    )
})

test("message mode rejects missing current task when backend is enabled", async () => {
    const sessionID = `ses_message_backend_missing_task_${Date.now()}`
    const rawMessages = buildMessages(sessionID)
    const state = createSessionState()

    const tool = createCompressMessageTool({
        client: buildClient(
            rawMessages,
            '{"summaries":[{"messageId":"m0001","topic":"Backend user","summary":"backend user summary"}]}',
        ),
        state,
        logger: new Logger(false),
        config: buildConfig("message"),
        prompts: {
            reload() {},
            getRuntimePrompts() {
                return { compressRange: "", compressMessage: "" }
            },
        },
    } as any)

    await assert.rejects(
        tool.execute(
            {
                retentionHint: "Keep user request and assistant findings",
                content: [{ messageId: "m0001" }],
            } as any,
            {
                ask: async () => {},
                metadata: () => {},
                sessionID,
                messageID: "msg-compress-backend-message-missing-task",
            },
        ),
        /compress backend mode requires non-empty currentTask/,
    )
})
