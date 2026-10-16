const PLUGIN_CLIENT_ID_PREFIX = "plugin:";
export function createPluginClientId(pluginId) {
    return `${PLUGIN_CLIENT_ID_PREFIX}${pluginId}`;
}
export function parsePluginClientId(clientId) {
    return isPluginClientId(clientId) ? clientId.slice(PLUGIN_CLIENT_ID_PREFIX.length) : null;
}
export function isPluginClientId(clientId) {
    return clientId.startsWith(PLUGIN_CLIENT_ID_PREFIX);
}
//# sourceMappingURL=plugin-session-identity.js.map