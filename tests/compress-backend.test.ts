import test from "node:test"
import assert from "node:assert/strict"
import { generateCompressionSummary } from "../lib/compress/backend"

test("returns undefined when backend is disabled", async () => {
    const result = await generateCompressionSummary({
        backend: {
            enabled: false,
            mode: "session-prompt",
            timeoutMs: 60000,
        },
    } as any)

    assert.equal(result, undefined)
})

test("uses configured model in a created backend session", async () => {
    let received: any
    let created: any
    const client = {
        session: {
            create: async (input: any) => {
                created = input
                return { data: { id: "ses_backend" } }
            },
            prompt: async (input: any) => {
                received = input
                return {
                    data: {
                        info: { id: "msg_backend", role: "assistant" },
                        parts: [{ type: "text", text: '{"summary":"backend summary"}' }],
                    },
                }
            },
        },
    }

    const result = await generateCompressionSummary({
        client,
        sessionId: "ses_main",
        backend: {
            enabled: true,
            mode: "session-prompt",
            timeoutMs: 60000,
            model: "openai/gpt-5-mini",
        },
        mode: "range",
        currentTask: "Continue auth cleanup",
        retentionHint: "Keep decisions, constraints, and pending fixes",
        selectedMessages: [],
    } as any)

    assert.equal(created.body.parentID, "ses_main")
    assert.equal(received.path.id, "ses_backend")
    assert.equal(received.body.model.providerID, "openai")
    assert.equal(received.body.model.modelID, "gpt-5-mini")
    assert.match(received.body.parts[0].text, /Current task: Continue auth cleanup/)
    assert.match(
        received.body.parts[0].text,
        /Retention checklist:\nKeep decisions, constraints, and pending fixes/,
    )
    assert.match(
        received.body.parts[0].text,
        /Do not treat the current task as a summary of those messages\./,
    )
    assert.deepEqual(result, { summary: "backend summary" })
})

test("rejects malformed backend response", async () => {
    const client = {
        session: {
            create: async () => ({ data: { id: "ses_backend" } }),
            prompt: async () => ({
                data: {
                    info: { id: "msg_backend", role: "assistant" },
                    parts: [{ type: "text", text: '{"summary":""}' }],
                },
            }),
        },
    }

    await assert.rejects(
        generateCompressionSummary({
            client,
            sessionId: "ses_main",
            backend: {
                enabled: true,
                mode: "session-prompt",
                timeoutMs: 60000,
                model: "openai/gpt-5-mini",
            },
            mode: "range",
            currentTask: "Continue auth cleanup",
            retentionHint: "Keep decisions, constraints, and pending fixes",
            selectedMessages: [],
        } as any),
        /backend response must include a non-empty summary/,
    )
})

test("times out backend generation", async () => {
    const client = {
        session: {
            create: async () => ({ data: { id: "ses_backend" } }),
            prompt: async () =>
                new Promise((resolve) => {
                    setTimeout(() => resolve({ data: { parts: [] } }), 50)
                }),
        },
    }

    await assert.rejects(
        generateCompressionSummary({
            client,
            sessionId: "ses_main",
            backend: {
                enabled: true,
                mode: "session-prompt",
                timeoutMs: 1,
                model: "openai/gpt-5-mini",
            },
            mode: "range",
            currentTask: "Continue auth cleanup",
            retentionHint: "Keep decisions, constraints, and pending fixes",
            selectedMessages: [],
        } as any),
        /timed out/,
    )
})
