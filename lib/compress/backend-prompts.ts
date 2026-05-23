import type { BackendMessageRequest, BackendRangeRequest } from "./backend-types"

const RANGE_RESPONSE_SHAPE =
    '{"summary":"concise technical summary preserving decisions, constraints, file paths, commands, errors, and next steps"}'
const MESSAGE_RESPONSE_SHAPE =
    '{"summaries":[{"messageId":"m0001","topic":"short topic","summary":"concise technical summary preserving decisions, constraints, file paths, commands, errors, and next steps"}]}'

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

function buildBackendPrompt(
    header: string,
    topicLabel: string,
    topic: string,
    selectedMessages: Array<{ id: string; role: string; text: string }>,
    responseShape: string,
    extraSection?: string,
): string {
    return `${header}

${topicLabel}: ${topic}${extraSection ? `\n${extraSection}` : ""}

Selected messages:
${formatMessages(selectedMessages)}

Return only JSON in this exact shape:
${responseShape}`
}

export function buildRangeBackendPrompt(request: BackendRangeRequest): string {
    return buildBackendPrompt(
        "You are generating a compact replacement summary for a selected conversation range.",
        "Topic",
        request.topic,
        request.selectedMessages,
        RANGE_RESPONSE_SHAPE,
    )
}

export function buildMessageBackendPrompt(request: BackendMessageRequest): string {
    return buildBackendPrompt(
        "You are generating compact replacement summaries for selected conversation messages.",
        "Batch topic",
        request.topic,
        request.selectedMessages,
        MESSAGE_RESPONSE_SHAPE,
        `Target message IDs: ${(request.targets ?? []).map((target) => target.messageId).join(", ")}`,
    )
}
