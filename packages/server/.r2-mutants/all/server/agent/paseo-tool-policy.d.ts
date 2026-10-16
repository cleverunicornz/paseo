import type { ProviderPaseoToolsPolicy } from "@getpaseo/protocol/provider-config";
interface ProviderPaseoToolSettings {
    paseoTools?: ProviderPaseoToolsPolicy;
}
export declare function resolvePaseoToolPolicy(providerId: string, providerSettings: Readonly<Record<string, ProviderPaseoToolSettings>> | undefined): ProviderPaseoToolsPolicy | undefined;
export declare function isPaseoToolEnabled(policy: ProviderPaseoToolsPolicy | undefined, toolName: string): boolean;
export declare function isPaseoToolPolicyEnabled(policy: ProviderPaseoToolsPolicy | undefined): boolean;
export {};
//# sourceMappingURL=paseo-tool-policy.d.ts.map