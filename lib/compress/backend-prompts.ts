import type { BackendMessageRequest, BackendRangeRequest } from "./backend-types"

function formatMessages(messages: Array<{ id: string; role: string; text: string }>): string {
    if (messages.length === 0) {
        return "(No message text was available.)"
    }

    return messages
        .map((message) => {
            return `### ${message.id} (${message.role})\n${message.text.trim()}`
        })
        .join("\n\n")
}

export function buildRangeBackendPrompt(request: BackendRangeRequest): string {
    return `You are generating a compact replacement summary for a selected conversation range.

Topic: ${request.topic}

Selected messages:
${formatMessages(request.selectedMessages)}

Return only JSON in this exact shape:
{"summary":"concise technical summary preserving decisions, constraints, file paths, commands, errors, and next steps"}`
}

export function buildMessageBackendPrompt(request: BackendMessageRequest): string {
    return `You are generating compact replacement summaries for selected conversation messages.

Batch topic: ${request.topic}
Target message IDs: ${(request.targets ?? []).map((target) => target.messageId).join(", ")}

Selected messages:
${formatMessages(request.selectedMessages)}

Return only JSON in this exact shape:
{"summary":"concise technical summary preserving decisions, constraints, file paths, commands, errors, and next steps"}`
}
