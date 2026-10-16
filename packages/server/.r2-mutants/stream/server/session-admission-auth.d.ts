import type { WSHelloMessage } from "@getpaseo/protocol/messages";
import type { SessionAdmission } from "./websocket-server.js";
export type AdmissionFailure = "password_required" | "incorrect_password";
type AdmissionResolution = {
    admission: SessionAdmission;
} | {
    rejection: AdmissionFailure;
};
export declare function resolveSessionAdmission(input: {
    credential: WSHelloMessage["auth"];
    passwordHash: string | undefined;
    localCredential: string | null;
    transport: "direct" | "relay";
}): Promise<AdmissionResolution>;
export {};
//# sourceMappingURL=session-admission-auth.d.ts.map