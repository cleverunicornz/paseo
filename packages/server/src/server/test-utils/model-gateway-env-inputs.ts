/**
 * Inputs and expectations for launches whose model traffic goes through the
 * daemon's gateway. Stated here independently of the implementation, so a
 * test fails when the implementation's rules drift from the documented ones.
 */

/**
 * Credential, provider-selector, credential-file and redirection variables a
 * harness could inherit. None of them may reach a gateway harness.
 */
export const CREDENTIAL_AND_REDIRECTION_INPUTS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "CODEX_API_KEY",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "ANTHROPIC_FOUNDRY_RESOURCE",
  "CLOUD_ML_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_CONFIG_FILE",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "CLOUDSDK_CONFIG",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TENANT_ID",
  "AZURE_OPENAI_API_KEY",
  "HTTP_PROXY",
  "http_proxy",
  "Http_Proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "FTP_PROXY",
] as const;

export type InputSource = "daemon" | "settings" | "launch";

/** One distinct value per variable and source, so any survivor is identifiable. */
export function credentialInputs(source: InputSource): Record<string, string> {
  return Object.fromEntries(
    CREDENTIAL_AND_REDIRECTION_INPUTS.map((name) => [
      name,
      `synthetic-${source}-${name.toLowerCase()}`,
    ]),
  );
}

/** The documented base variables a gateway harness keeps from its inherited environment. */
export const DOCUMENTED_BASE_NAMES = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "TERM",
  "TZ",
  "TMPDIR",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
]);

export function isDocumentedBaseName(name: string): boolean {
  return DOCUMENTED_BASE_NAMES.has(name) || name.startsWith("LC_");
}

/** A configured pass-through list and the inherited values it admits. */
export const PASSTHROUGH = ["TOOL_SETTING", "TOOLKIT_*"];
export const PASSTHROUGH_INPUTS = {
  daemon: { TOOL_SETTING: "daemon-tool-setting", TOOLKIT_COLOR: "daemon-toolkit-color" },
  settings: { TOOL_SETTING: "settings-tool-setting", TOOLKIT_LEVEL: "settings-toolkit-level" },
} as const;
/**
 * Inherited variables that are neither base nor configured; they are dropped.
 * The harness data directories are among them: the pass-through list cannot
 * name them, so a deployment that relocates them supplies them as trusted
 * launch values.
 */
export const UNLISTED_INPUTS = {
  UNLISTED_SETTING: "unlisted",
  TOOLBOX: "not-a-toolkit-match",
  CLAUDE_CONFIG_DIR: "unlisted-claude-config-dir",
  CODEX_HOME: "unlisted-codex-home",
  // Matched by the configured `TOOLKIT_*` prefix, but a proxy name never passes.
  TOOLKIT_PROXY: "http://proxy.invalid:3128",
};

/** Paseo's own launch values for an agent: per-agent values and plugin-supplied values. */
export function paseoLaunchValues(agentId: string, cwd: string): Record<string, string> {
  return { PASEO_AGENT_ID: agentId, PASEO_AGENT_CWD: cwd, COMPANY_ENV: "development" };
}

export const LOOPBACK_NO_PROXY = "127.0.0.1,localhost,::1";

/**
 * The complete environment a gateway harness must receive: the documented
 * base variables from the daemon's environment, configured pass-through (a
 * runtime-settings value wins over the daemon's), Paseo's launch values,
 * `NO_PROXY`/`no_proxy`, and the harness's own gateway values.
 */
export function expectedGatewayEnv(input: {
  daemonEnv: NodeJS.ProcessEnv;
  launchValues: Record<string, string>;
  noProxy: string;
  gatewayValues: Record<string, string>;
}): Record<string, string> {
  const expected: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.daemonEnv)) {
    if (value !== undefined && isDocumentedBaseName(name)) {
      expected[name] = value;
    }
  }
  Object.assign(expected, PASSTHROUGH_INPUTS.daemon, PASSTHROUGH_INPUTS.settings);
  Object.assign(expected, input.launchValues);
  expected.NO_PROXY = input.noProxy;
  expected.no_proxy = input.noProxy;
  return Object.assign(expected, input.gatewayValues);
}

/** Sets every daemon-side input on `process.env`; returns a restore function. */
export function inheritOnDaemonProcess(): () => void {
  const values: Record<string, string> = {
    ...credentialInputs("daemon"),
    ...PASSTHROUGH_INPUTS.daemon,
    ...UNLISTED_INPUTS,
  };
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  return () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
}

/** Runtime-settings inputs: every credential input plus configured and unlisted values. */
export function settingsInputs(): Record<string, string> {
  return {
    ...credentialInputs("settings"),
    ...PASSTHROUGH_INPUTS.settings,
    ...UNLISTED_INPUTS,
  };
}
