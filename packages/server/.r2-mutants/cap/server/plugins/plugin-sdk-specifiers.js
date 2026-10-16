// These entries are supplied by the host and remain external in author bundles.
export const PLUGIN_CLIENT_ONLY_SDK_SPECIFIERS = [
    "@getpaseo/plugin/client",
    "@getpaseo/plugin/client/ui",
    "@getpaseo/plugin/client/react-native",
];
const PLUGIN_SERVER_ONLY_SDK_SPECIFIERS = [
    "@getpaseo/plugin/server",
    "@getpaseo/plugin/server/provider",
    "@getpaseo/plugin/server/usage",
    "@getpaseo/plugin/server/acp",
];
export const PLUGIN_SDK_SPECIFIERS = [
    "@getpaseo/plugin",
    ...PLUGIN_SERVER_ONLY_SDK_SPECIFIERS,
    ...PLUGIN_CLIENT_ONLY_SDK_SPECIFIERS,
];
export function isPluginClientOnlySdkSpecifier(name) {
    return PLUGIN_CLIENT_ONLY_SDK_SPECIFIERS.includes(name);
}
export function isPluginServerOnlySdkSpecifier(name) {
    return PLUGIN_SERVER_ONLY_SDK_SPECIFIERS.includes(name);
}
//# sourceMappingURL=plugin-sdk-specifiers.js.map