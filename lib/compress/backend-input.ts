import type {
    CompressMessageBackendToolArgs,
    CompressMessageToolArgs,
    CompressRangeBackendToolArgs,
    CompressRangeToolArgs,
} from "./types"

const BACKEND_TOPIC_PLACEHOLDER = "__backend_topic__"
const BACKEND_SUMMARY_PLACEHOLDER = "__backend_summary__"

function hasSummaryInput(content: unknown): boolean {
    return (
        Array.isArray(content) &&
        content.some((item) => item && typeof item === "object" && "summary" in item)
    )
}

export function assertBackendGeneratedInput(args: { content?: unknown }): void {
    if (hasSummaryInput(args.content)) {
        throw new Error("compress backend mode does not accept summary input")
    }
}

function assertBackendIntent(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`compress backend mode requires non-empty ${field}`)
    }

    return value.trim()
}

export function normalizeRangeToolArgs(
    args: CompressRangeToolArgs | CompressRangeBackendToolArgs,
    backendEnabled: boolean,
): CompressRangeToolArgs {
    if (!backendEnabled) {
        return args as CompressRangeToolArgs
    }

    const backendArgs = args as CompressRangeBackendToolArgs
    assertBackendIntent(backendArgs.retentionHint, "retentionHint")

    return {
        topic: assertBackendIntent(backendArgs.currentTask, "currentTask"),
        content: backendArgs.content.map((entry) => ({
            ...entry,
            summary: BACKEND_SUMMARY_PLACEHOLDER,
        })),
    }
}

export function normalizeMessageToolArgs(
    args: CompressMessageToolArgs | CompressMessageBackendToolArgs,
    backendEnabled: boolean,
): CompressMessageToolArgs {
    if (!backendEnabled) {
        return args as CompressMessageToolArgs
    }

    const backendArgs = args as CompressMessageBackendToolArgs
    assertBackendIntent(backendArgs.retentionHint, "retentionHint")

    return {
        topic: assertBackendIntent(backendArgs.currentTask, "currentTask"),
        content: backendArgs.content.map((entry) => ({
            ...entry,
            topic: BACKEND_TOPIC_PLACEHOLDER,
            summary: BACKEND_SUMMARY_PLACEHOLDER,
        })),
    }
}
