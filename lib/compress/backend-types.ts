export interface BackendModelRef {
    providerID: string
    modelID: string
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
