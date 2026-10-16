import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { generateKeyPair, exportPublicKey, exportSecretKey, importPublicKey, importSecretKey, } from "@getpaseo/relay/e2ee";
import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";
const KeyPairSchema = z.object({
    v: z.literal(2),
    publicKeyB64: z.string().min(1),
    secretKeyB64: z.string().min(1),
});
const KEYPAIR_FILENAME = "daemon-keypair.json";
export async function loadOrCreateDaemonKeyPair(paseoHome, logger) {
    const log = logger?.child({ module: "daemon-keypair" });
    const filePath = path.join(paseoHome, KEYPAIR_FILENAME);
    if (existsSync(filePath)) {
        try {
            ensurePrivateFile(filePath);
            const raw = readFileSync(filePath, "utf8");
            const parsed = KeyPairSchema.parse(JSON.parse(raw));
            const publicKey = importPublicKey(parsed.publicKeyB64);
            const secretKey = importSecretKey(parsed.secretKeyB64);
            const publicKeyB64 = exportPublicKey(publicKey);
            log?.info({ filePath }, "Loaded daemon keypair");
            return { keyPair: { publicKey, secretKey }, publicKeyB64 };
        }
        catch (error) {
            log?.warn({ err: error, filePath }, "Failed to load daemon keypair, regenerating");
        }
    }
    const keyPair = generateKeyPair();
    const publicKeyB64 = exportPublicKey(keyPair.publicKey);
    const secretKeyB64 = exportSecretKey(keyPair.secretKey);
    const payload = {
        v: 2,
        publicKeyB64,
        secretKeyB64,
    };
    writePrivateFileAtomicSync(filePath, JSON.stringify(payload, null, 2) + "\n");
    log?.info({ filePath }, "Saved daemon keypair");
    return { keyPair, publicKeyB64 };
}
//# sourceMappingURL=daemon-keypair.js.map