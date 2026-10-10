import type { SessionIdentity } from "../session-runtime-config.js";
import type {
  AgentClient,
  AgentPersistenceHandle,
  AgentProvider,
  AgentSessionConfig,
  FetchCatalogOptions,
  ImportProviderSessionContext,
  ImportProviderSessionInput,
  ProviderRefreshContext,
} from "./agent-sdk-types.js";

export class SessionMemberError extends Error {
  constructor(
    readonly member: string,
    readonly attempted: string,
  ) {
    super(
      `This session's member is ${member}. This agent would run ${attempted}. A different model needs a new session.`,
    );
    this.name = "SessionMemberError";
  }
}

/** ASCII-only lowercasing, so Unicode case folding never turns another value into a member. */
function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** Clients already behind a gate, so a client handed on from one owner to another is wrapped once. */
const guardedClients = new WeakSet<AgentClient>();

/**
 * Session mode's one admission point. Every provider session or runtime the
 * daemon starts goes through an `AgentClient`; `guard` wraps each client so
 * nothing starts unless it runs the session's member: a session or resume only
 * with the member's provider and model, an import only of a session recorded
 * with it, and discovery (catalogues, availability, command and feature
 * probes, importable sessions) only for the member's provider and model. A
 * discovery for anything else returns nothing.
 */
export class SessionMemberGate {
  private readonly memberProvider: string | null;
  private readonly wrappers = new WeakMap<AgentClient, Map<AgentProvider, AgentClient>>();

  constructor(readonly member: string) {
    const slash = member.indexOf("/");
    this.memberProvider = slash < 0 ? null : member.slice(0, slash);
  }

  static of(identity: SessionIdentity | null | undefined): SessionMemberGate | null {
    return identity ? new SessionMemberGate(identity.member) : null;
  }

  /**
   * The refusal for running `model` of `provider`, or null when that is the
   * member. The value is lowercased and otherwise compared as given: a
   * suffixed variant such as `[1m]` is a different model.
   */
  refusal(provider: AgentProvider, model: string | null | undefined): SessionMemberError | null {
    const attempted = model
      ? asciiLowercase(`${provider}/${model}`)
      : `${asciiLowercase(provider)} without a model`;
    return attempted === this.member ? null : new SessionMemberError(this.member, attempted);
  }

  assert(provider: AgentProvider, model: string | null | undefined): void {
    const refusal = this.refusal(provider, model);
    if (refusal) throw refusal;
  }

  admitsProvider(provider: AgentProvider): boolean {
    return asciiLowercase(provider) === this.memberProvider;
  }

  assertProvider(provider: AgentProvider): void {
    if (!this.admitsProvider(provider)) {
      throw new SessionMemberError(this.member, asciiLowercase(provider));
    }
  }

  /** The client registered as `provider`, behind this gate. Wrapping the same client again returns the same wrapper. */
  guard(provider: AgentProvider, client: AgentClient): AgentClient {
    if (guardedClients.has(client)) return client;
    let byProvider = this.wrappers.get(client);
    if (!byProvider) {
      byProvider = new Map();
      this.wrappers.set(client, byProvider);
    }
    let wrapper = byProvider.get(provider);
    if (!wrapper) {
      wrapper = new GuardedAgentClient(provider, client, this);
      guardedClients.add(wrapper);
      byProvider.set(provider, wrapper);
    }
    return wrapper;
  }
}

/** The model a resume runs: the launch configuration's, else the one the handle recorded. */
function resumedModel(
  handle: AgentPersistenceHandle,
  overrides: Partial<AgentSessionConfig> | undefined,
): string | null {
  if (overrides?.model) return overrides.model;
  const recorded = handle.metadata?.model;
  return typeof recorded === "string" ? recorded : null;
}

/**
 * Delegates to the client it wraps, looked up on every call, after the gate
 * admits what the call would start. Optional methods exist exactly when the
 * wrapped client has them.
 */
class GuardedAgentClient implements AgentClient {
  constructor(
    private readonly providerId: AgentProvider,
    private readonly inner: AgentClient,
    private readonly gate: SessionMemberGate,
  ) {}

  get provider() {
    return this.inner.provider;
  }

  get capabilities() {
    return this.inner.capabilities;
  }

  get supportsModelGateway() {
    return this.inner.supportsModelGateway;
  }

  private get admitsProvider(): boolean {
    return this.gate.admitsProvider(this.providerId);
  }

  async createSession(...args: Parameters<AgentClient["createSession"]>) {
    this.gate.assert(this.providerId, args[0].model);
    return this.inner.createSession(...args);
  }

  async resumeSession(...args: Parameters<AgentClient["resumeSession"]>) {
    this.gate.assert(this.providerId, resumedModel(args[0], args[1]));
    return this.inner.resumeSession(...args);
  }

  async fetchCatalog(options: FetchCatalogOptions, context?: ProviderRefreshContext) {
    if (!this.admitsProvider) return { models: [], modes: [] };
    return this.inner.fetchCatalog(options, context);
  }

  async isAvailable(...args: Parameters<AgentClient["isAvailable"]>) {
    if (!this.admitsProvider) return false;
    return this.inner.isAvailable(...args);
  }

  get getCatalogCacheKey(): AgentClient["getCatalogCacheKey"] {
    return this.inner.getCatalogCacheKey?.bind(this.inner);
  }

  get resolveConfiguredModel(): AgentClient["resolveConfiguredModel"] {
    return this.inner.resolveConfiguredModel?.bind(this.inner);
  }

  get resolveCreateConfig(): AgentClient["resolveCreateConfig"] {
    return this.inner.resolveCreateConfig?.bind(this.inner);
  }

  get isCreateConfigUnattended(): AgentClient["isCreateConfigUnattended"] {
    return this.inner.isCreateConfigUnattended?.bind(this.inner);
  }

  get archiveNativeSession(): AgentClient["archiveNativeSession"] {
    return this.inner.archiveNativeSession?.bind(this.inner);
  }

  get unarchiveNativeSession(): AgentClient["unarchiveNativeSession"] {
    return this.inner.unarchiveNativeSession?.bind(this.inner);
  }

  get shutdown(): AgentClient["shutdown"] {
    return this.inner.shutdown?.bind(this.inner);
  }

  get resolveDefaultModeId(): AgentClient["resolveDefaultModeId"] {
    const resolve = this.inner.resolveDefaultModeId?.bind(this.inner);
    if (!resolve) return undefined;
    return async (input) => (this.admitsProvider ? resolve(input) : undefined);
  }

  get getDiagnostic(): AgentClient["getDiagnostic"] {
    const diagnose = this.inner.getDiagnostic?.bind(this.inner);
    if (!diagnose) return undefined;
    return async () =>
      this.admitsProvider
        ? diagnose()
        : { diagnostic: `Not available in this session: its member is ${this.gate.member}.` };
  }

  get listCommands(): AgentClient["listCommands"] {
    const list = this.inner.listCommands?.bind(this.inner);
    if (!list) return undefined;
    return async (config) => (this.gate.refusal(this.providerId, config.model) ? [] : list(config));
  }

  get listFeatures(): AgentClient["listFeatures"] {
    const list = this.inner.listFeatures?.bind(this.inner);
    if (!list) return undefined;
    return async (config) => (this.gate.refusal(this.providerId, config.model) ? [] : list(config));
  }

  get listImportableSessions(): AgentClient["listImportableSessions"] {
    const list = this.inner.listImportableSessions?.bind(this.inner);
    if (!list) return undefined;
    return async (options) => (this.admitsProvider ? list(options) : []);
  }

  get importSession(): AgentClient["importSession"] {
    const importSession = this.inner.importSession?.bind(this.inner);
    if (!importSession) return undefined;
    return async (input: ImportProviderSessionInput, context: ImportProviderSessionContext) => {
      this.gate.assertProvider(this.providerId);
      const imported = await importSession(input, {
        ...context,
        // The import knows the model the native session recorded only once it reads it.
        admit: (config) => this.gate.assert(this.providerId, config.model),
      });
      // An importer that opened its session without asking is closed before anything uses it.
      const refusal = this.gate.refusal(this.providerId, imported.config.model);
      if (refusal) {
        await imported.session.close().catch(() => undefined);
        throw refusal;
      }
      return imported;
    };
  }
}
