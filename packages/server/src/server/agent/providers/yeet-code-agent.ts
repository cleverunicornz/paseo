import { z } from "zod";
import type { Logger } from "pino";

import type {
  AgentClient,
  AgentCreateSessionOptions,
  AgentLaunchContext,
  AgentPersistenceHandle,
  AgentResumeSessionOptions,
  AgentSession,
  AgentSessionConfig,
  FetchCatalogOptions,
  ImportableProviderSession,
  ImportedProviderSession,
  ImportProviderSessionContext,
  ImportProviderSessionInput,
  ListImportableSessionsOptions,
  ProviderCatalog,
  ProviderRefreshContext,
} from "../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../provider-launch-config.js";
import {
  DEFAULT_REMOTE_ACP_V2_CAPABILITIES,
  RemoteACPv2AgentClient,
  type RemoteACPv2ConnectionFactory,
  type RemoteACPv2Endpoint,
} from "./remote-acp-v2-agent.js";

export const YEET_CODE_PROVIDER_ID = "yeet-code";
export const YEET_CODE_GATEWAY_URL_ENV = "YEET_CODE_GATEWAY_URL";
export const YEET_CODE_GATEWAY_TOKEN_ENV = "YEET_CODE_GATEWAY_TOKEN";

export const YeetCodeProviderParamsSchema = z
  .object({
    url: z.url().optional(),
    tokenEnv: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/u, "tokenEnv must be an environment variable name")
      .optional(),
  })
  .strict();

export interface YeetCodeAgentClientOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  providerParams?: unknown;
  connectionFactory?: RemoteACPv2ConnectionFactory;
  processEnv?: NodeJS.ProcessEnv;
}

function resolveEndpoint(options: YeetCodeAgentClientOptions): RemoteACPv2Endpoint {
  const params = YeetCodeProviderParamsSchema.parse(options.providerParams ?? {});
  const runtimeEnv = options.runtimeSettings?.env ?? {};
  const processEnv = options.processEnv ?? process.env;
  const endpoint =
    params.url ?? runtimeEnv[YEET_CODE_GATEWAY_URL_ENV] ?? processEnv[YEET_CODE_GATEWAY_URL_ENV];
  const tokenEnv = params.tokenEnv ?? YEET_CODE_GATEWAY_TOKEN_ENV;
  const bearerToken = runtimeEnv[tokenEnv] ?? processEnv[tokenEnv];
  if (!endpoint) {
    throw new Error(
      `Provider '${YEET_CODE_PROVIDER_ID}' requires params.url or ${YEET_CODE_GATEWAY_URL_ENV}`,
    );
  }
  if (!bearerToken?.trim()) {
    throw new Error(`Provider '${YEET_CODE_PROVIDER_ID}' requires ${tokenEnv}`);
  }
  return { endpoint, bearerToken };
}

export class YeetCodeAgentClient implements AgentClient {
  readonly provider = YEET_CODE_PROVIDER_ID;
  readonly capabilities = DEFAULT_REMOTE_ACP_V2_CAPABILITIES;

  private readonly options: YeetCodeAgentClientOptions;

  constructor(options: YeetCodeAgentClientOptions) {
    this.options = options;
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
    options?: AgentCreateSessionOptions,
  ): Promise<AgentSession> {
    return this.client().createSession(config, launchContext, options);
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
    options?: AgentResumeSessionOptions,
  ): Promise<AgentSession> {
    return this.client().resumeSession(handle, overrides, launchContext, options);
  }

  async fetchCatalog(
    options: FetchCatalogOptions,
    context?: ProviderRefreshContext,
  ): Promise<ProviderCatalog> {
    context?.signal.throwIfAborted();
    return this.client().fetchCatalog(options, context);
  }

  async listImportableSessions(
    options?: ListImportableSessionsOptions,
  ): Promise<ImportableProviderSession[]> {
    return this.client().listImportableSessions(options);
  }

  async importSession(
    input: ImportProviderSessionInput,
    context: ImportProviderSessionContext,
  ): Promise<ImportedProviderSession> {
    return this.client().importSession(input, context);
  }

  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    try {
      return await this.client().isAvailable(signal);
    } catch {
      return false;
    }
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    try {
      return await this.client().getDiagnostic();
    } catch (error) {
      return {
        diagnostic: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private client(): RemoteACPv2AgentClient {
    return new RemoteACPv2AgentClient({
      provider: this.provider,
      logger: this.options.logger,
      endpoint: resolveEndpoint(this.options),
      ...(this.options.connectionFactory
        ? { connectionFactory: this.options.connectionFactory }
        : {}),
    });
  }
}

export const __yeetCodeInternals = { resolveEndpoint };
