import test from "node:test"
import assert from "node:assert/strict"
import { validateConfigTypes } from "../lib/config"

test("compress backend model is optional when backend is disabled", () => {
    const errors = validateConfigTypes({
        compress: {
            backend: {
                enabled: false,
            },
        },
    })

    assert.deepEqual(errors, [])
})

test("compress backend model is required when backend is enabled", () => {
    const errors = validateConfigTypes({
        compress: {
            backend: {
                enabled: true,
            },
        },
    })

    assert.ok(errors.some((entry) => entry.key === "compress.backend.model"))
})

test("compress backend model must use provider/modelID format", () => {
    const errors = validateConfigTypes({
        compress: {
            backend: {
                enabled: true,
                model: "gpt-5-mini",
            },
        },
    })

    assert.ok(errors.some((entry) => entry.key === "compress.backend.model"))
})
