import test from "node:test"
import assert from "node:assert/strict"
import { parseBackendModelRef } from "../lib/compress/backend-types"

test("parseBackendModelRef splits provider and model on first slash", () => {
    assert.deepEqual(parseBackendModelRef("openai/gpt-5-mini"), {
        providerID: "openai",
        modelID: "gpt-5-mini",
    })
})

test("parseBackendModelRef keeps remaining slashes in model id", () => {
    assert.deepEqual(parseBackendModelRef("provider/family/model"), {
        providerID: "provider",
        modelID: "family/model",
    })
})

test("parseBackendModelRef rejects missing slash", () => {
    assert.throws(() => parseBackendModelRef("gpt-5-mini"))
})
