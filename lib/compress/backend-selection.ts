import type { BackendSelectedMessage } from "./backend-types"

function messageText(message: any): string {
    const parts = Array.isArray(message?.parts) ? message.parts : []
    return parts
        .map((part: any) => {
            if (part?.type === "text" && typeof part.text === "string") {
                return part.text
            }
            if (part?.type === "tool" && typeof part.state?.output === "string") {
                return `[tool:${part.tool || "unknown"}]\n${part.state.output}`
            }
            return ""
        })
        .filter(Boolean)
        .join("\n")
}

export function selectedMessagesForBackend(
    messageIds: string[],
    rawMessagesById: Map<string, any>,
): BackendSelectedMessage[] {
    return messageIds
        .map((id) => {
            const message = rawMessagesById.get(id)
            if (!message) {
                return undefined
            }
            return {
                id,
                role: String(message.info?.role || "unknown"),
                text: messageText(message),
            }
        })
        .filter((message): message is BackendSelectedMessage => message !== undefined)
}
