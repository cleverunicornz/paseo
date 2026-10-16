import net from "node:net";
import { execCommand } from "../utils/spawn.js";
import { findFreePort } from "./service-proxy.js";
const PORT_SCRIPT_TIMEOUT_MS = 10000;
const PORT_SCRIPT_MAX_OUTPUT_BYTES = 1024;
const TCP_PORT_MIN = 1;
const TCP_PORT_MAX = 65535;
export async function allocateWorkspaceServicePort(options) {
    if (options.allocation?.portScript) {
        return await allocatePortFromScript({
            cwd: options.cwd,
            command: options.allocation.portScript,
            scriptName: options.scriptName,
            workspaceId: options.workspaceId,
            branchName: options.branchName,
            reservedPorts: options.reservedPorts,
        });
    }
    if (options.allocation?.range) {
        return await allocatePortFromRange(parsePortRange(options.allocation.range), options.reservedPorts ?? new Set());
    }
    return await findFreePort();
}
async function allocatePortFromScript(options) {
    let result;
    try {
        result = await execCommand(options.command, [options.scriptName, options.workspaceId, options.branchName ?? "", options.cwd], {
            cwd: options.cwd,
            envOverlay: {
                PASEO_SCRIPTNAME: options.scriptName,
                PASEO_WORKSPACE_ID: options.workspaceId,
                PASEO_BRANCH_NAME: options.branchName ?? "",
                PASEO_WORKTREE_PATH: options.cwd,
            },
            timeout: PORT_SCRIPT_TIMEOUT_MS,
            maxBuffer: PORT_SCRIPT_MAX_OUTPUT_BYTES,
            shell: false,
        });
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Service port script '${options.command}' failed: ${detail}`, { cause: error });
    }
    const output = result.stdout.trim();
    if (!/^\d+$/.test(output)) {
        throw new Error(`Service port script '${options.command}' must print exactly one TCP port`);
    }
    const port = Number(output);
    if (!isValidTcpPort(port)) {
        throw new Error(`Service port script '${options.command}' returned invalid TCP port '${output}'`);
    }
    if (options.reservedPorts?.has(port)) {
        throw new Error(`Service port script '${options.command}' returned reserved port ${port}`);
    }
    return port;
}
async function allocatePortFromRange(range, reservedPorts) {
    const count = range.end - range.start + 1;
    const startOffset = Math.floor(Math.random() * count);
    for (let offset = 0; offset < count; offset += 1) {
        const port = range.start + ((startOffset + offset) % count);
        if (reservedPorts.has(port))
            continue;
        if (await isPortAvailable(port))
            return port;
    }
    throw new Error(`No available service port in configured range ${range.start}-${range.end}`);
}
function parsePortRange(value) {
    const [start, end] = value.split("-").map(Number);
    if (!isValidTcpPort(start) || !isValidTcpPort(end) || start > end) {
        throw new Error(`Invalid service port range '${value}'`);
    }
    return { start, end };
}
function isValidTcpPort(port) {
    return Number.isInteger(port) && port >= TCP_PORT_MIN && port <= TCP_PORT_MAX;
}
async function isPortAvailable(port) {
    return await new Promise((resolve) => {
        const server = net.createServer();
        server.unref();
        server.once("error", () => resolve(false));
        server.listen(port, "127.0.0.1", () => {
            server.close((error) => resolve(!error));
        });
    });
}
//# sourceMappingURL=workspace-service-port-allocator.js.map