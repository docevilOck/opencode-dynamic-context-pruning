export interface BackendModelRef {
    providerID: string
    modelID: string
}

export interface BackendSelectedMessage {
    id: string
    role: string
    text: string
}

export interface BackendBaseRequest {
    client: any
    sessionId: string
    backend: {
        enabled: boolean
        mode: "session-prompt"
        timeoutMs: number
        model?: string
    }
    currentTask: string
    retentionHint: string
    selectedMessages: BackendSelectedMessage[]
}

export interface BackendRangeRequest extends BackendBaseRequest {
    mode: "range"
}

export interface BackendMessageRequest extends BackendBaseRequest {
    mode: "message"
    targets?: Array<{ messageId: string }>
}

export type BackendSummaryRequest = BackendRangeRequest | BackendMessageRequest

export interface BackendSummaryResult {
    summary: string
}

export interface BackendMessageSummary {
    messageId: string
    topic: string
    summary: string
}

export interface BackendMessageSummaryResult {
    summaries: BackendMessageSummary[]
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
