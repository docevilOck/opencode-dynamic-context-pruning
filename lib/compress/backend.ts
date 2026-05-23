import { buildMessageBackendPrompt, buildRangeBackendPrompt } from "./backend-prompts"
import {
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

function parseSummary(text: string): BackendSummaryResult {
    let parsed: any
    try {
        parsed = JSON.parse(text)
    } catch {
        throw new Error("compress backend response must be valid JSON")
    }

    if (typeof parsed?.summary !== "string" || parsed.summary.trim().length === 0) {
        throw new Error("compress backend response must include a non-empty summary")
    }

    return {
        summary: parsed.summary.trim(),
    }
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
    request: BackendSummaryRequest,
): Promise<BackendSummaryResult | undefined> {
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

    return parseSummary(extractText(response))
}
