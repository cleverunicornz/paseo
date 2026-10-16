import { createProviderEnvSpec, resolveProviderLaunch, } from "../../provider-launch-config.js";
import { execCommand } from "../../../../utils/spawn.js";
import { OpenCodeAgentClient } from "../opencode-agent.js";
import { withOpenCodeRuntimeNotice } from "./runtime-notice.js";
// Keep the minimum aligned with the SDK and binary exercised by CI.
const MINIMUM_V2 = [0, 10];
const VERSION_PATTERN = /^(?:opencode\s+)?v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/i;
export function openCodeMajorVersion(output) {
    const version = output.trim().match(VERSION_PATTERN);
    if (!version)
        return 1;
    if (version[1] === "1")
        return 1;
    if (version[1] === "2") {
        const [minimumMinor, minimumPatch] = MINIMUM_V2;
        const minor = Number(version[2]);
        const patch = Number(version[3]);
        if (minor < minimumMinor || (minor === minimumMinor && patch < minimumPatch))
            throw new Error(`OpenCode ${version[1]}.${version[2]}.${version[3]} is too old for this Paseo integration. Update OpenCode to 2.${minimumMinor}.${minimumPatch} or newer, then refresh the provider in Paseo.`);
        return 2;
    }
    throw new Error(`Unsupported OpenCode major version ${version[1]}; supported versions are 1 and 2`);
}
// Selection belongs to the configured client, which provider reload replaces.
export class OpenCodeRuntimeClient {
    constructor(logger, settings, options = {}) {
        this.logger = logger;
        this.settings = settings;
        this.options = options;
        this.provider = "opencode";
        this.selected = null;
        this.legacySelected = false;
        this.legacy = new OpenCodeAgentClient(logger, settings, options);
        this.capabilities = this.legacy.capabilities;
        this.resolveCreateConfig = this.legacy.resolveCreateConfig;
        this.isCreateConfigUnattended = this.legacy.isCreateConfigUnattended;
    }
    client() {
        this.selected ?? (this.selected = (async () => {
            let output;
            try {
                const launch = await resolveProviderLaunch({
                    commandConfig: this.settings?.command,
                    defaultBinary: "opencode",
                });
                const result = await execCommand(launch.command, [...launch.args, "--version"], {
                    ...createProviderEnvSpec({ runtimeSettings: this.settings }),
                    timeout: 5000,
                });
                output = result.stdout;
            }
            catch {
                // Version discovery is additive: legacy wrappers need not support --version.
                this.selected = null;
                this.legacySelected = true;
                return this.legacy;
            }
            if (!VERSION_PATTERN.test(output.trim()))
                this.selected = null;
            if (openCodeMajorVersion(output) === 1) {
                this.legacySelected = true;
                return this.legacy;
            }
            const { OpenCodeV2AgentClient } = await import("./v2/agent.js");
            return new OpenCodeV2AgentClient({
                logger: this.logger,
                settings: this.settings,
                managedProcesses: this.options.managedProcesses,
                bridge: this.options.bridge,
            });
        })().catch((error) => {
            // A failed probe must not poison refresh after the user updates the binary.
            this.selected = null;
            throw error;
        }));
        return this.selected;
    }
    async isAvailable() {
        return this.legacy.isAvailable();
    }
    async getDiagnostic() {
        return this.legacy.getDiagnostic();
    }
    async createSession(config, launch, options) {
        const client = await this.client();
        const session = await client.createSession(config, launch, options);
        return client === this.legacy ? session : withOpenCodeRuntimeNotice(session, 2);
    }
    async resumeSession(handle, config, launch) {
        const client = await this.client();
        const session = await client.resumeSession(handle, config, launch);
        return client === this.legacy ? session : withOpenCodeRuntimeNotice(session, 2, handle);
    }
    async fetchCatalog(options, context) {
        return (await this.client()).fetchCatalog(options, context);
    }
    async listCommands(config) {
        return (await this.client()).listCommands(config);
    }
    async listFeatures(config) {
        return (await this.client()).listFeatures(config);
    }
    async listImportableSessions(options) {
        return (await this.client()).listImportableSessions(options);
    }
    async importSession(input, context) {
        const client = await this.client();
        const imported = await client.importSession(input, context);
        return client === this.legacy
            ? imported
            : { ...imported, session: withOpenCodeRuntimeNotice(imported.session, 2) };
    }
    async archiveNativeSession(handle) {
        const client = await this.client();
        if (client instanceof OpenCodeAgentClient)
            await client.archiveNativeSession(handle);
    }
    async unarchiveNativeSession(handle) {
        const client = await this.client();
        if (client instanceof OpenCodeAgentClient)
            await client.unarchiveNativeSession(handle);
    }
    async shutdown() {
        const selected = await this.selected?.catch(() => null);
        if (this.legacySelected)
            await this.legacy.shutdown();
        if (selected && selected !== this.legacy)
            await selected.shutdown();
    }
}
//# sourceMappingURL=runtime-client.js.map