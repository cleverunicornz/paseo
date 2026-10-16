import { isSpeakToolName } from "@getpaseo/protocol/tool-name-normalization";
/** Voice assistant policy: only allow the speak tool. */
export function isVoicePermissionAllowed(request) {
    if (request.kind !== "tool") {
        return false;
    }
    const normalizedName = request.name.trim().toLowerCase();
    if (!normalizedName) {
        return false;
    }
    return isSpeakToolName(normalizedName);
}
//# sourceMappingURL=voice-permission-policy.js.map