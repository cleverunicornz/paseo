import type { ForgeService } from "./forge-service.js";
export type ForgeServiceFactory = () => ForgeService;
export interface ForgeAdapterRegistration {
    createService: ForgeServiceFactory;
    matchesHost?: (host: string) => boolean;
    probeHost?: (host: string) => Promise<boolean>;
}
/**
 * Open composition boundary for forge adapters. Resolver code depends only on
 * these registration hooks, so a new adapter does not require another branch.
 */
export declare class ForgeRegistry {
    #private;
    constructor(entries?: Iterable<readonly [string, ForgeAdapterRegistration]>);
    register(forge: string, adapter: ForgeAdapterRegistration): () => void;
    ids(): string[];
    has(forge: string): boolean;
    create(forge: string): ForgeService | null;
    matchHost(host: string): string | null;
    probeHost(host: string): Promise<string | null>;
}
export declare const defaultForgeRegistry: ForgeRegistry;
export declare function createForgeService(forge: string): ForgeService | null;
export declare function probeRegisteredForgeHost(host: string): Promise<string | null>;
//# sourceMappingURL=forge-registry.d.ts.map