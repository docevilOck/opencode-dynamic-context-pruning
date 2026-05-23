import { buildMessageBackendPrompt, buildRangeBackendPrompt } from "./backend-prompts"
import {
    type BackendMessageSummaryResult,
    type BackendSummaryRequest,
    type BackendSummaryResult,
    parseBackendModelRef,
} from "./backend-types"

function responseData(response: any): any {
    return response?.data ?? response
}

function extractSessionId(response: any): string {
    const data = responseData(response)
    const id = data?.id
    if (typeof id !== "string" || id.trim().length === 0) {
        throw new Error("compress backend session creation did not return a session id")
    }
    return id
}

function extractText(response: any): string {
    const data = responseData(response)
    const parts = Array.isArray(data?.parts) ? data.parts : []
    const text = parts
        .filter((part: any) => part?.type === "text" && typeof part.text === "string")
        .map((part: any) => part.text)
        .join("\n")
        .trim()

    if (!text) {
        throw new Error("compress backend response did not include text")
    }

    return text
}

function parseJsonResponse(text: string): any {
    try {
        return JSON.parse(text)
    } catch {
        throw new Error("compress backend response must be valid JSON")
    }
}

function parseSummary(text: string): BackendSummaryResult {
    const parsed = parseJsonResponse(text)
    if (typeof parsed?.summary !== "string" || parsed.summary.trim().length === 0) {
        throw new Error("compress backend response must include a non-empty summary")
    }

    return {
        summary: parsed.summary.trim(),
    }
}

function parseMessageSummaries(text: string): BackendMessageSummaryResult {
    const parsed = parseJsonResponse(text)
    if (!Array.isArray(parsed?.summaries)) {
        throw new Error("compress backend response must include summaries")
    }

    const summaries = parsed.summaries.map((entry: any) => {
        if (typeof entry?.messageId !== "string" || entry.messageId.trim().length === 0) {
            throw new Error("compress backend message summary must include messageId")
        }
        if (typeof entry?.topic !== "string" || entry.topic.trim().length === 0) {
            throw new Error("compress backend message summary must include topic")
        }
        if (typeof entry?.summary !== "string" || entry.summary.trim().length === 0) {
            throw new Error("compress backend message summary must include summary")
        }

        return {
            messageId: entry.messageId.trim(),
            topic: entry.topic.trim(),
            summary: entry.summary.trim(),
        }
    })

    return { summaries }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
            reject(new Error(`compress backend generation timed out after ${timeoutMs}ms`))
        }, timeoutMs)
    })

    try {
        return await Promise.race([promise, timeoutPromise])
    } finally {
        if (timeout) {
            clearTimeout(timeout)
        }
    }
}

export async function generateCompressionSummary(
    request: BackendSummaryRequest & { mode: "range" },
): Promise<BackendSummaryResult | undefined>
export async function generateCompressionSummary(
    request: BackendSummaryRequest & { mode: "message" },
): Promise<BackendMessageSummaryResult | undefined>
export async function generateCompressionSummary(
    request: BackendSummaryRequest,
): Promise<BackendSummaryResult | BackendMessageSummaryResult | undefined> {
    if (!request.backend.enabled) {
        return undefined
    }

    if (request.backend.mode !== "session-prompt") {
        throw new Error(`Unsupported compress backend mode: ${request.backend.mode}`)
    }

    if (!request.backend.model) {
        throw new Error("compress.backend.model is required when backend is enabled")
    }

    const model = parseBackendModelRef(request.backend.model)
    const prompt =
        request.mode === "range"
            ? buildRangeBackendPrompt(request)
            : buildMessageBackendPrompt(request)

    const created = await request.client.session.create({
        body: {
            parentID: request.sessionId,
            title: `DCP compact: ${request.topic}`,
        },
    })
    const backendSessionId = extractSessionId(created)

    const response = await withTimeout(
        request.client.session.prompt({
            path: {
                id: backendSessionId,
            },
            body: {
                model,
                parts: [
                    {
                        type: "text",
                        text: prompt,
                    },
                ],
            },
        }),
        request.backend.timeoutMs,
    )

    const text = extractText(response)
    return request.mode === "range" ? parseSummary(text) : parseMessageSummaries(text)
}
