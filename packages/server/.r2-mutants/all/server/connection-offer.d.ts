import { type ConnectionOffer } from "@getpaseo/protocol/connection-offer";
interface BuildOfferEndpointsArgs {
    listenHost: string;
    port: number;
}
export declare function buildOfferEndpoints({ listenHost, port }: BuildOfferEndpointsArgs): string[];
export declare function createConnectionOfferV2(args: {
    serverId: string;
    daemonPublicKeyB64: string;
    relay: {
        endpoint: string;
        useTls?: boolean;
    };
}): Promise<ConnectionOffer>;
export declare function encodeOfferToFragmentUrl(args: {
    offer: ConnectionOffer;
    appBaseUrl: string;
}): string;
export {};
//# sourceMappingURL=connection-offer.d.ts.map