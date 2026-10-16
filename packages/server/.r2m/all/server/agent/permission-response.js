import { startAgentRun } from "./agent-prompt.js";
export async function respondToAgentPermission(params) {
    const { agentManager, agentId, requestId, response, logger } = params;
    logger.debug({ agentId, requestId }, `Handling permission response for agent ${agentId}, request ${requestId}`);
    const result = await agentManager.respondToPermission(agentId, requestId, response);
    logger.debug({ agentId }, `Permission response forwarded to agent ${agentId}`);
    if (result?.followUpPrompt) {
        logger.debug({ agentId }, "Permission response requires follow-up turn, starting agent stream");
        await startAgentRun(agentManager, agentId, result.followUpPrompt, logger, {
            replaceRunning: true,
        });
    }
}
//# sourceMappingURL=permission-response.js.map