const workspaceServicePortPlans = new Map();
const pendingWorkspaceServicePortPlans = new Map();
const pendingWorkspaceServicePortPlanTokens = new Map();
const dynamicPortOwners = new Map();
const dynamicPortsByWorkspace = new Map();
const MAX_DYNAMIC_PORT_ALLOCATION_ATTEMPTS = 10;
export async function ensureWorkspaceServicePortPlan(options) {
    const existingPlan = workspaceServicePortPlans.get(options.workspaceId);
    if (existingPlan) {
        return new Map(existingPlan);
    }
    let pendingPlan = pendingWorkspaceServicePortPlans.get(options.workspaceId);
    if (!pendingPlan) {
        const token = { isReleased: false };
        pendingPlan = createPendingWorkspaceServicePortPlan({
            workspaceId: options.workspaceId,
            services: options.services,
            allocatePort: options.allocatePort,
            token,
        });
        pendingWorkspaceServicePortPlans.set(options.workspaceId, pendingPlan);
        pendingWorkspaceServicePortPlanTokens.set(options.workspaceId, token);
    }
    return new Map(await pendingPlan);
}
export function requirePlannedWorkspaceServicePort(plan, scriptName) {
    const port = plan.get(scriptName);
    if (port === undefined) {
        throw new Error(`Service '${scriptName}' is missing from workspace service port plan`);
    }
    return port;
}
export function releaseWorkspaceServicePortPlan(workspaceId) {
    const pendingToken = pendingWorkspaceServicePortPlanTokens.get(workspaceId);
    if (pendingToken)
        pendingToken.isReleased = true;
    workspaceServicePortPlans.delete(workspaceId);
    const dynamicPorts = dynamicPortsByWorkspace.get(workspaceId);
    if (!dynamicPorts)
        return;
    for (const [scriptName, port] of dynamicPorts) {
        releaseDynamicPort({ workspaceId, scriptName, port });
    }
    dynamicPortsByWorkspace.delete(workspaceId);
}
async function createPendingWorkspaceServicePortPlan(options) {
    try {
        const plan = await buildWorkspaceServicePortPlan({
            workspaceId: options.workspaceId,
            services: options.services,
            allocatePort: options.allocatePort,
        });
        if (options.token.isReleased) {
            throw new Error(`Workspace service port plan was released while being created for '${options.workspaceId}'`);
        }
        workspaceServicePortPlans.set(options.workspaceId, plan);
        return plan;
    }
    catch (error) {
        releaseWorkspaceServicePortPlan(options.workspaceId);
        throw error;
    }
    finally {
        pendingWorkspaceServicePortPlans.delete(options.workspaceId);
        pendingWorkspaceServicePortPlanTokens.delete(options.workspaceId);
    }
}
async function buildWorkspaceServicePortPlan(options) {
    const explicitPortOwners = new Map();
    for (const service of options.services) {
        if (service.port === undefined)
            continue;
        if (explicitPortOwners.has(service.port)) {
            throw new Error(`Service '${service.scriptName}' has a duplicate port ${service.port}`);
        }
        explicitPortOwners.set(service.port, service.scriptName);
    }
    const plan = new Map();
    for (const service of options.services) {
        if (service.port !== undefined) {
            plan.set(service.scriptName, service.port);
            continue;
        }
        const reservedPorts = new Set([...explicitPortOwners.keys(), ...plan.values()]);
        plan.set(service.scriptName, await resolveServicePort({
            service,
            workspaceId: options.workspaceId,
            allocatePort: options.allocatePort,
            reservedPorts,
        }));
    }
    return plan;
}
export async function refreshWorkspaceServicePort(options) {
    const plan = workspaceServicePortPlans.get(options.workspaceId) ?? new Map();
    const reservedPorts = new Set(plan.values());
    const previousPort = plan.get(options.service.scriptName);
    if (previousPort !== undefined) {
        reservedPorts.delete(previousPort);
    }
    const oldDynamicPort = dynamicPortsByWorkspace
        .get(options.workspaceId)
        ?.get(options.service.scriptName);
    const port = await resolveServicePort({
        service: options.service,
        workspaceId: options.workspaceId,
        allocatePort: options.allocatePort,
        reservedPorts,
    });
    if (oldDynamicPort !== undefined && oldDynamicPort !== port) {
        releaseDynamicPort({
            workspaceId: options.workspaceId,
            scriptName: options.service.scriptName,
            port: oldDynamicPort,
        });
    }
    plan.set(options.service.scriptName, port);
    workspaceServicePortPlans.set(options.workspaceId, plan);
    return port;
}
async function resolveServicePort(options) {
    const { service, workspaceId, allocatePort, reservedPorts } = options;
    if (service.port !== undefined) {
        if (reservedPorts.has(service.port)) {
            throw new Error(`Service '${service.scriptName}' has a duplicate port ${service.port}`);
        }
        return service.port;
    }
    for (let attempt = 0; attempt < MAX_DYNAMIC_PORT_ALLOCATION_ATTEMPTS; attempt += 1) {
        const unavailablePorts = new Set(reservedPorts);
        const serviceOwner = toServiceOwner(workspaceId, service.scriptName);
        for (const [port, owner] of dynamicPortOwners) {
            if (owner !== serviceOwner)
                unavailablePorts.add(port);
        }
        const port = await allocatePort({
            scriptName: service.scriptName,
            reservedPorts: unavailablePorts,
        });
        if (reservedPorts.has(port))
            continue;
        const owner = dynamicPortOwners.get(port);
        if (owner !== undefined && owner !== serviceOwner)
            continue;
        reserveDynamicPort({ workspaceId, scriptName: service.scriptName, port });
        return port;
    }
    throw new Error(`Could not allocate a unique port for service '${service.scriptName}' after ${MAX_DYNAMIC_PORT_ALLOCATION_ATTEMPTS} attempts`);
}
function reserveDynamicPort(options) {
    dynamicPortOwners.set(options.port, toServiceOwner(options.workspaceId, options.scriptName));
    const workspacePorts = dynamicPortsByWorkspace.get(options.workspaceId) ?? new Map();
    workspacePorts.set(options.scriptName, options.port);
    dynamicPortsByWorkspace.set(options.workspaceId, workspacePorts);
}
function releaseDynamicPort(options) {
    const owner = toServiceOwner(options.workspaceId, options.scriptName);
    if (dynamicPortOwners.get(options.port) === owner) {
        dynamicPortOwners.delete(options.port);
    }
    const workspacePorts = dynamicPortsByWorkspace.get(options.workspaceId);
    if (workspacePorts?.get(options.scriptName) === options.port) {
        workspacePorts.delete(options.scriptName);
        if (workspacePorts.size === 0) {
            dynamicPortsByWorkspace.delete(options.workspaceId);
        }
    }
}
function toServiceOwner(workspaceId, scriptName) {
    return `${workspaceId}\0${scriptName}`;
}
//# sourceMappingURL=workspace-service-port-registry.js.map