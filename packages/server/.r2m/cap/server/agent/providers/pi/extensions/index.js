import { PiExtensionHost } from "./host.js";
import { piExtensions } from "./registry.js";
export const piExtensionRuntimeBridge = piExtensions
    .flatMap((extension) => extension.runtimeBridge ?? [])
    .join("\n");
export function createPiExtensionHost(logger, extensions = piExtensions, hydrationByteBudget) {
    return new PiExtensionHost(extensions, logger, hydrationByteBudget);
}
//# sourceMappingURL=index.js.map