import { tool } from "@opencode-ai/plugin"
import type { ToolContext } from "./types"
import { countTokens } from "../token-utils"
import { assertBackendGeneratedInput, normalizeMessageToolArgs } from "./backend-input"
import {
    MESSAGE_BACKEND_FORMAT_EXTENSION,
    MESSAGE_FORMAT_EXTENSION,
} from "../prompts/extensions/tool"
import { generateCompressionSummary } from "./backend"
import { selectedMessagesForBackend } from "./backend-selection"
import { formatIssues, formatResult, resolveMessages, validateArgs } from "./message-utils"
import { finalizeSession, prepareSession, type NotificationEntry } from "./pipeline"
import { appendProtectedPromptInfo, appendProtectedTools } from "./protected-content"
import {
    allocateBlockId,
    allocateRunId,
    applyCompressionState,
    wrapCompressedSummary,
} from "./state"
import type { CompressMessageBackendToolArgs, CompressMessageToolArgs } from "./types"

function requireMatchingBackendSummaries(
    requestedIds: string[],
    summaries: Array<{ messageId: string; topic: string; summary: string }>,
): Map<string, { topic: string; summary: string }> {
    const requested = new Set(requestedIds)
    const received = new Map<string, { topic: string; summary: string }>()

    for (const entry of summaries) {
        if (!requested.has(entry.messageId) || received.has(entry.messageId)) {
            throw new Error("backend summaries must match requested message ids")
        }
        received.set(entry.messageId, {
            topic: entry.topic,
            summary: entry.summary,
        })
    }

    if (received.size !== requested.size) {
        throw new Error("backend summaries must match requested message ids")
    }

    return received
}

function buildSchema(backendEnabled: boolean) {
    if (backendEnabled) {
        return {
            topic: tool.schema
                .string()
                .describe(
                    "Short label (3-5 words) for the overall batch - e.g., 'Closed Research Notes'",
                ),
            content: tool.schema
                .array(
                    tool.schema.object({
                        messageId: tool.schema
                            .string()
                            .describe("Raw message ID to compress (e.g. m0001)"),
                    }),
                )
                .describe("Batch of individual messages to compress using backend summaries"),
        }
    }

    return {
        topic: tool.schema
            .string()
            .describe(
                "Short label (3-5 words) for the overall batch - e.g., 'Closed Research Notes'",
            ),
        content: tool.schema
            .array(
                tool.schema.object({
                    messageId: tool.schema
                        .string()
                        .describe("Raw message ID to compress (e.g. m0001)"),
                    topic: tool.schema
                        .string()
                        .describe("Short label (3-5 words) for this one message summary"),
                    summary: tool.schema
                        .string()
                        .describe("Complete technical summary replacing that one message"),
                }),
            )
            .describe("Batch of individual message summaries to create in one tool call"),
    }
}

export function createCompressMessageTool(ctx: ToolContext): ReturnType<typeof tool> {
    ctx.prompts.reload()
    const runtimePrompts = ctx.prompts.getRuntimePrompts()
    const backendEnabled = ctx.config.compress.backend?.enabled ?? false
    const formatExtension = backendEnabled
        ? MESSAGE_BACKEND_FORMAT_EXTENSION
        : MESSAGE_FORMAT_EXTENSION

    return tool({
        description: runtimePrompts.compressMessage + formatExtension,
        args: buildSchema(backendEnabled),
        async execute(args, toolCtx) {
            if (backendEnabled) {
                assertBackendGeneratedInput(args)
            }

            const backendArgs = args as unknown as CompressMessageBackendToolArgs
            const input = normalizeMessageToolArgs(
                args as CompressMessageToolArgs | CompressMessageBackendToolArgs,
                backendEnabled,
            )
            validateArgs(input)
            const callId =
                typeof (toolCtx as unknown as { callID?: unknown }).callID === "string"
                    ? (toolCtx as unknown as { callID: string }).callID
                    : undefined

            const { rawMessages, searchContext } = await prepareSession(
                ctx,
                toolCtx,
                `Compress Message: ${input.topic}`,
            )
            const { plans, skippedIssues, skippedCount } = resolveMessages(
                input,
                searchContext,
                ctx.state,
                ctx.config,
            )

            if (plans.length === 0 && skippedCount > 0) {
                throw new Error(formatIssues(skippedIssues, skippedCount))
            }

            if (backendEnabled && plans.length > 0) {
                const requestedIds = plans.map((plan) => plan.entry.messageId)
                const backendResult = await generateCompressionSummary({
                    client: ctx.client,
                    sessionId: toolCtx.sessionID,
                    backend: ctx.config.compress.backend,
                    mode: "message",
                    currentTask: backendArgs.currentTask,
                    retentionHint: backendArgs.retentionHint,
                    targets: requestedIds.map((messageId) => ({ messageId })),
                    selectedMessages: selectedMessagesForBackend(
                        requestedIds,
                        searchContext.rawMessagesById,
                    ),
                })
                if (!backendResult) {
                    throw new Error("compress backend did not return summaries")
                }

                const summariesById = requireMatchingBackendSummaries(
                    requestedIds,
                    backendResult.summaries,
                )
                for (const plan of plans) {
                    const summary = summariesById.get(plan.entry.messageId)
                    if (!summary) {
                        throw new Error("backend summaries must match requested message ids")
                    }
                    plan.entry.topic = summary.topic
                    plan.entry.summary = summary.summary
                }
            }

            const notifications: NotificationEntry[] = []

            const preparedPlans: Array<{
                plan: (typeof plans)[number]
                summaryWithTools: string
            }> = []

            for (const plan of plans) {
                const summaryWithPromptInfo = appendProtectedPromptInfo(
                    plan.entry.summary,
                    plan.selection,
                    searchContext,
                    ctx.state,
                    ctx.config.compress.protectTags,
                )

                const summaryWithTools = await appendProtectedTools(
                    ctx.client,
                    ctx.state,
                    ctx.config.experimental.allowSubAgents,
                    summaryWithPromptInfo,
                    plan.selection,
                    searchContext,
                    ctx.config.compress.protectedTools,
                    ctx.config.protectedFilePatterns,
                )

                preparedPlans.push({
                    plan,
                    summaryWithTools,
                })
            }

            const runId = allocateRunId(ctx.state)

            for (const { plan, summaryWithTools } of preparedPlans) {
                const blockId = allocateBlockId(ctx.state)
                const storedSummary = wrapCompressedSummary(blockId, summaryWithTools)
                const summaryTokens = countTokens(storedSummary)

                applyCompressionState(
                    ctx.state,
                    {
                        topic: plan.entry.topic,
                        batchTopic: input.topic,
                        startId: plan.entry.messageId,
                        endId: plan.entry.messageId,
                        mode: "message",
                        runId,
                        compressMessageId: toolCtx.messageID,
                        compressCallId: callId,
                        summaryTokens,
                    },
                    plan.selection,
                    plan.anchorMessageId,
                    blockId,
                    storedSummary,
                    [],
                )

                notifications.push({
                    blockId,
                    runId,
                    summary: summaryWithTools,
                    summaryTokens,
                })
            }

            await finalizeSession(ctx, toolCtx, rawMessages, notifications, input.topic)

            return formatResult(plans.length, skippedIssues, skippedCount)
        },
    })
}
