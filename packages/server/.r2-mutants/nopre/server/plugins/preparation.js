import { spawnProcess } from "../../utils/spawn.js";
const OUTPUT_LIMIT = 64 * 1024;
export async function runPluginBuild(directory, commands, logger) {
    for (const command of commands ?? []) {
        logger.info({ directory, command }, "Running plugin build command");
        const result = await run(command, directory);
        if (result.stdout)
            logger.info({ directory, command, output: result.stdout }, "Plugin build stdout");
        if (result.stderr)
            logger.info({ directory, command, output: result.stderr }, "Plugin build stderr");
        if (result.error) {
            throw new Error(`Plugin build command failed to start: ${formatCommand(command)}\n${result.error.message}`);
        }
        if (result.exitCode !== 0) {
            throw new Error(`Plugin build command failed (exit ${result.exitCode}): ${formatCommand(command)}${formatOutput(result)}`);
        }
    }
}
function run(command, directory) {
    return new Promise((resolve) => {
        const executable = command[0];
        const arguments_ = command.slice(1);
        const child = spawnProcess(executable, arguments_, { cwd: directory });
        let stdout = "";
        let stderr = "";
        let error;
        child.stdout?.on("data", (chunk) => {
            stdout = appendOutput(stdout, chunk.toString());
        });
        child.stderr?.on("data", (chunk) => {
            stderr = appendOutput(stderr, chunk.toString());
        });
        child.once("error", (spawnError) => {
            error = spawnError;
        });
        child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr, error }));
    });
}
function appendOutput(current, next) {
    return `${current}${next}`.slice(-OUTPUT_LIMIT);
}
function formatCommand(command) {
    return command.map((argument) => JSON.stringify(argument)).join(" ");
}
function formatOutput(result) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    return output ? `\n${output}` : "";
}
//# sourceMappingURL=preparation.js.map