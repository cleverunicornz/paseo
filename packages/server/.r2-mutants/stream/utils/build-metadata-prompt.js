import { readPaseoConfigJson } from "./paseo-config-file.js";
import { PaseoConfigSchema, } from "@getpaseo/protocol/paseo-config-schema";
export async function buildMetadataPrompt(options) {
    const overrides = await readProjectMetadataOverrides(options);
    const styleBlocks = options.styles.map((section) => renderStyleSection(section, overrides?.[section.configKey]?.instructions));
    const head = [options.contract, ...styleBlocks, options.after].join("\n\n");
    return options.trailing ? `${head}\n\n${options.trailing}` : head;
}
function renderStyleSection(section, override) {
    const body = isNonEmptyString(override) ? override.trim() : section.default;
    return section.label ? `${section.label}:\n${body}` : body;
}
async function readProjectMetadataOverrides(options) {
    if (!options.workspaceGitService) {
        return undefined;
    }
    try {
        const repoRoot = await options.workspaceGitService.resolveRepoRoot(options.cwd);
        const json = readPaseoConfigJson(repoRoot);
        return PaseoConfigSchema.parse(json).metadataGeneration;
    }
    catch {
        return undefined;
    }
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
}
//# sourceMappingURL=build-metadata-prompt.js.map