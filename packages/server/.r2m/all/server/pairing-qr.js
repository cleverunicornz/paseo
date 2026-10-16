import * as QRCode from "qrcode";
const BLACK_ON_WHITE = "\u001b[47m\u001b[30m";
const RESET_COLORS = "\u001b[0m";
export async function renderPairingQr(url) {
    const utf8Options = {
        type: "utf8",
        margin: 4,
    };
    const qr = await QRCode.toString(url, utf8Options);
    return qr
        .split("\n")
        .map((line) => `${BLACK_ON_WHITE}${line}${RESET_COLORS}`)
        .join("\n");
}
//# sourceMappingURL=pairing-qr.js.map