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

export function normalizeRangeToolArgs(
    args: CompressRangeToolArgs | CompressRangeBackendToolArgs,
    backendEnabled: boolean,
): CompressRangeToolArgs {
    if (!backendEnabled) {
        return args as CompressRangeToolArgs
    }

    return {
        topic: args.topic,
        content: args.content.map((entry) => ({
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

    return {
        topic: args.topic,
        content: args.content.map((entry) => ({
            ...entry,
            topic: BACKEND_TOPIC_PLACEHOLDER,
            summary: BACKEND_SUMMARY_PLACEHOLDER,
        })),
    }
}
