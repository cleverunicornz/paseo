export declare function writeLocalCredential(home: string): Promise<string>;
export declare function deleteLocalCredential(home: string): Promise<void>;
export declare function readLocalCredential(home: string): string | null;
export declare function matchesLocalCredential(expected: string, candidate: string): boolean;
export declare function readLocalCredentialForTarget(home: string, target: string): string | null;
//# sourceMappingURL=local-credential.d.ts.map