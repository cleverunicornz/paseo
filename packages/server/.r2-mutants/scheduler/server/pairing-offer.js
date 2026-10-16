import { createConnectionOfferV2, encodeOfferToFragmentUrl } from "./connection-offer.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { renderPairingQr } from "./pairing-qr.js";
import { getOrCreateServerId } from "./server-id.js";
export async function generateLocalPairingOffer(args) {
    const relayEnabled = args.relayEnabled ?? true;
    if (!relayEnabled) {
        return {
            relayEnabled: false,
            url: null,
            qr: null,
        };
    }
    const relayEndpoint = args.relayEndpoint ?? "relay.paseo.sh:443";
    const relayPublicEndpoint = args.relayPublicEndpoint ?? relayEndpoint;
    const relayUseTls = args.relayUseTls ?? relayEndpoint === "relay.paseo.sh:443";
    const relayPublicUseTls = args.relayPublicUseTls ?? relayUseTls;
    const appBaseUrl = args.appBaseUrl ?? "https://app.paseo.sh";
    const serverId = getOrCreateServerId(args.paseoHome, { logger: args.logger });
    const daemonKeyPair = await loadOrCreateDaemonKeyPair(args.paseoHome, args.logger);
    const offer = await createConnectionOfferV2({
        serverId,
        daemonPublicKeyB64: daemonKeyPair.publicKeyB64,
        relay: { endpoint: relayPublicEndpoint, useTls: relayPublicUseTls },
    });
    const url = encodeOfferToFragmentUrl({ offer, appBaseUrl });
    if (args.includeQr === false) {
        return {
            relayEnabled: true,
            url,
            qr: null,
        };
    }
    let qr = null;
    try {
        qr = await renderPairingQr(url);
    }
    catch (error) {
        args.logger?.debug({ error }, "Failed to render pairing QR");
    }
    return {
        relayEnabled: true,
        url,
        qr,
    };
}
//# sourceMappingURL=pairing-offer.js.map