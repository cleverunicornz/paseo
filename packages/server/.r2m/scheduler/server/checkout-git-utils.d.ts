export declare const READ_ONLY_GIT_ENV: {
    readonly GIT_OPTIONAL_LOCKS: "0";
};
export type CheckoutErrorCode = "NOT_GIT_REPO" | "NOT_ALLOWED" | "MERGE_CONFLICT" | "UNKNOWN";
export interface CheckoutErrorPayload {
    code: CheckoutErrorCode;
    message: string;
}
export declare function resolveCheckoutGitDir(cwd: string): Promise<string | null>;
export declare function toCheckoutError(error: unknown): CheckoutErrorPayload;
//# sourceMappingURL=checkout-git-utils.d.ts.map