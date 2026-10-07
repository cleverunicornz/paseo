import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig, resolveBundledWebUiDistDir, resolveConfigFromPersisted } from "./config.js";
import { loadPersistedConfig, PersistedConfigSchema } from "./persisted-config.js";
import {
  isMcpGatewayBackendUrl,
  MCP_GATEWAY_BACKEND_NAME_PATTERN,
  MCP_GATEWAY_MODEL_PROVIDER_PATTERN,
  parseMcpGatewayBackends,
  parseMcpGatewayModelBackends,
} from "./mcp-gateway/backends.js";
import {
  MCP_GATEWAY_ENV_PASSTHROUGH_ENTRY_PATTERN_SOURCE,
  MCP_GATEWAY_REFUSED_ENV_PASSTHROUGH_PATTERN_SOURCE,
  parseMcpGatewayEnvPassthrough,
} from "./agent/model-gateway-env.js";

const roots: string[] = [];

describe("server config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("records when the daemon is managed by Paseo Desktop", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-desktop-managed-"));
    roots.push(paseoHome);

    const desktopConfig = loadConfig(paseoHome, {
      env: { PASEO_DESKTOP_MANAGED: "1" },
    });
    const standaloneConfig = loadConfig(paseoHome, { env: {} });

    expect(desktopConfig.desktopManaged).toBe(true);
    expect(standaloneConfig.desktopManaged).toBe(false);
  });

  test("loads the provider catalog refresh timeout", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-provider-timeout-"));
    roots.push(paseoHome);
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({ agents: { catalogRefreshTimeoutMs: 180_000 } }),
    );

    const config = loadConfig(paseoHome, { env: {} });

    expect(config.providerCatalogRefreshTimeoutMs).toBe(180_000);
  });

  test("resolves reload state from the supplied validated snapshot", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-snapshot-"));
    roots.push(paseoHome);
    const snapshot = loadPersistedConfig(paseoHome);
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({
        ...snapshot,
        daemon: { ...snapshot.daemon, browserTools: { enabled: true } },
      }),
    );

    expect(resolveConfigFromPersisted(paseoHome, snapshot, { env: {} }).browserToolsEnabled).toBe(
      false,
    );
    expect(loadConfig(paseoHome, { env: {} }).browserToolsEnabled).toBe(true);
  });

  test("records mutable and startup launch overrides by persisted leaf", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-overrides-"));
    roots.push(paseoHome);
    const config = loadConfig(paseoHome, {
      env: {
        PASEO_LISTEN: "127.0.0.1:7000",
        PASEO_PASSWORD: "secret",
        PASEO_RELAY_ENDPOINT: "relay.example.test:443",
        PASEO_TRUSTED_PROXIES: "true",
        PASEO_WEB_UI_ENABLED: "true",
        PASEO_LOG_FILE_PATH: "custom.log",
        PASEO_VOICE_LLM_PROVIDER: "codex",
      },
      cli: { relayUseTls: false },
    });

    expect(config.configReload?.overrideControlledPaths).toEqual([
      "daemon.auth.password",
      "daemon.listen",
      "daemon.relay.endpoint",
      "daemon.relay.useTls",
      "daemon.trustedProxies",
      "features.voiceMode.llm.provider",
      "features.webUi.enabled",
      "log.file.path",
    ]);
    expect(config.listen).toBe("127.0.0.1:7000");
    expect(config.trustedProxies).toBe(true);
    expect(config.log?.file?.path).toBe("custom.log");
    expect(config.voiceLlmProvider).toBe("codex");
  });

  test.each([
    {
      name: "local speech providers",
      providers: { dictation: "local", voiceStt: "local", voiceTts: "local" },
      expected: [
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
      ],
    },
    {
      name: "OpenAI speech providers",
      providers: { dictation: "openai", voiceStt: "openai", voiceTts: "openai" },
      expected: [
        "features.dictation.stt.confidenceThreshold",
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
        "features.voiceMode.tts.voice",
      ],
    },
    {
      name: "mixed local and OpenAI speech providers",
      providers: { dictation: "local", voiceStt: "openai", voiceTts: "local" },
      expected: [
        "features.dictation.stt.confidenceThreshold",
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
      ],
    },
  ])("classifies speech overrides for $name", ({ providers, expected }) => {
    const config = resolveConfigFromPersisted(
      "/tmp/paseo-speech-override-classification",
      {
        version: 1,
        features: {
          dictation: { enabled: true, stt: { provider: providers.dictation } },
          voiceMode: {
            enabled: true,
            stt: { provider: providers.voiceStt },
            tts: { provider: providers.voiceTts },
          },
        },
      },
      {
        env: {
          OPENAI_API_KEY: "test-api-key",
          PASEO_DICTATION_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
          PASEO_VOICE_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
          PASEO_VOICE_LOCAL_TTS_MODEL: "kokoro-en-v0_19",
          STT_CONFIDENCE_THRESHOLD: "0.5",
          STT_MODEL: "whisper-1",
          TTS_MODEL: "tts-1",
          TTS_VOICE: "alloy",
        },
      },
    );

    expect(config.configReload?.overrideControlledPaths).toEqual(expected);
  });

  test("loads named MCP gateway backends from config and lets the environment replace them", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-mcp-gateway-"));
    roots.push(paseoHome);
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({
        daemon: {
          mcp: { gateway: { backends: { cluster: "https://cluster-mcp.example/mcp" } } },
        },
      }),
    );

    const fromFile = loadConfig(paseoHome, { env: {} });
    const fromEnv = loadConfig(paseoHome, {
      env: { PASEO_MCP_GATEWAY_BACKENDS: '{"docs":"http://127.0.0.1:9000/mcp"}' },
    });

    expect(fromFile.mcpGatewayBackends).toEqual({
      cluster: { url: "https://cluster-mcp.example/mcp" },
    });
    expect(fromFile.configReload?.overrideControlledPaths).not.toContain(
      "daemon.mcp.gateway.backends",
    );
    expect(fromEnv.mcpGatewayBackends).toEqual({ docs: { url: "http://127.0.0.1:9000/mcp" } });
    expect(fromEnv.configReload?.overrideControlledPaths).toContain("daemon.mcp.gateway.backends");
  });

  test("loads a backend's own response-header timeout from config and the environment", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-mcp-gateway-timeout-"));
    roots.push(paseoHome);
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({
        daemon: {
          mcp: {
            gateway: {
              backends: {
                cluster: "https://cluster-mcp.example/mcp",
                models: { url: "https://models.example/v1", responseTimeoutMs: 600_000 },
              },
            },
          },
        },
      }),
    );

    const fromFile = loadConfig(paseoHome, { env: {} });
    const fromEnv = loadConfig(paseoHome, {
      env: {
        PASEO_MCP_GATEWAY_BACKENDS:
          '{"models":{"url":"http://127.0.0.1:9000/v1","responseTimeoutMs":300000}}',
      },
    });

    expect(fromFile.mcpGatewayBackends).toEqual({
      cluster: { url: "https://cluster-mcp.example/mcp" },
      models: { url: "https://models.example/v1", responseTimeoutMs: 600_000 },
    });
    expect(fromEnv.mcpGatewayBackends).toEqual({
      models: { url: "http://127.0.0.1:9000/v1", responseTimeoutMs: 300_000 },
    });
  });

  test("loads the model gateway backends per provider and lets the environment replace them", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-model-gateway-"));
    roots.push(paseoHome);
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({
        daemon: {
          mcp: { gateway: { modelBackends: { claude: "anthropic", codex: "openai" } } },
        },
      }),
    );

    const fromFile = loadConfig(paseoHome, { env: {} });
    const fromEnv = loadConfig(paseoHome, {
      env: { PASEO_MCP_GATEWAY_MODEL_BACKENDS: '{"claude-work":"anthropic"}' },
    });
    const absent = loadConfig(await mkdtemp(path.join(os.tmpdir(), "paseo-config-none-")), {
      env: {},
    });

    expect(fromFile.mcpGatewayModelBackends).toEqual({ claude: "anthropic", codex: "openai" });
    expect(fromFile.configReload?.overrideControlledPaths).not.toContain(
      "daemon.mcp.gateway.modelBackends",
    );
    expect(fromEnv.mcpGatewayModelBackends).toEqual({ "claude-work": "anthropic" });
    expect(fromEnv.configReload?.overrideControlledPaths).toContain(
      "daemon.mcp.gateway.modelBackends",
    );
    expect(absent.mcpGatewayModelBackends).toEqual({});
  });

  test("loads the gateway environment pass-through list and lets the environment replace it", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-env-passthrough-"));
    roots.push(paseoHome);
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({
        daemon: { mcp: { gateway: { envPassthrough: ["TOOL_SETTING", "TOOLKIT_*"] } } },
      }),
    );

    const fromFile = loadConfig(paseoHome, { env: {} });
    const fromEnv = loadConfig(paseoHome, {
      env: { PASEO_MCP_GATEWAY_ENV_PASSTHROUGH: '["IS_SANDBOX"]' },
    });
    const absent = loadConfig(await mkdtemp(path.join(os.tmpdir(), "paseo-config-none-")), {
      env: {},
    });

    expect(fromFile.mcpGatewayEnvPassthrough).toEqual(["TOOL_SETTING", "TOOLKIT_*"]);
    expect(fromFile.configReload?.overrideControlledPaths).not.toContain(
      "daemon.mcp.gateway.envPassthrough",
    );
    expect(fromEnv.mcpGatewayEnvPassthrough).toEqual(["IS_SANDBOX"]);
    expect(fromEnv.configReload?.overrideControlledPaths).toContain(
      "daemon.mcp.gateway.envPassthrough",
    );
    expect(absent.mcpGatewayEnvPassthrough).toEqual([]);
  });

  test("local tools are on only when a Codex executable is configured", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-local-tools-"));
    roots.push(paseoHome);
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({
        daemon: {
          mcp: {
            localTools: { codexPath: "/opt/codex/bin/codex", codexHome: "/var/lib/paseo-codex" },
            toolTree: { enabled: true },
          },
        },
      }),
    );

    const fromFile = loadConfig(paseoHome, { env: {} });
    const fromEnv = loadConfig(paseoHome, {
      env: { PASEO_LOCAL_TOOLS_CODEX_PATH: "/usr/local/bin/codex" },
    });
    const absent = loadConfig(await mkdtemp(path.join(os.tmpdir(), "paseo-config-none-")), {
      env: {},
    });

    expect(fromFile.localTools).toEqual({
      codexPath: "/opt/codex/bin/codex",
      codexHome: "/var/lib/paseo-codex",
    });
    expect(fromFile.toolTree).toEqual({ enabled: true });
    expect(fromEnv.localTools).toEqual({
      codexPath: "/usr/local/bin/codex",
      codexHome: "/var/lib/paseo-codex",
    });
    expect(fromEnv.configReload?.overrideControlledPaths).toContain(
      "daemon.mcp.localTools.codexPath",
    );
    expect(absent.localTools).toBeNull();
    expect(absent.toolTree).toEqual({ enabled: false });
  });

  test("rejects a relative Codex executable path for local tools", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-local-tools-bad-"));
    roots.push(paseoHome);
    expect(() => loadConfig(paseoHome, { env: { PASEO_LOCAL_TOOLS_CODEX_PATH: "codex" } })).toThrow(
      /absolute/,
    );
    expect(
      PersistedConfigSchema.safeParse({
        daemon: { mcp: { localTools: { codexPath: "bin/codex" } } },
      }).success,
    ).toBe(false);
  });

  test("a provider's harness built-in tools can be turned off", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-builtin-tools-"));
    roots.push(paseoHome);
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({
        agents: { providers: { claude: { builtinTools: "off" }, codex: { builtinTools: "on" } } },
      }),
    );

    const config = loadConfig(paseoHome, { env: {} });

    expect(config.providerOverrides?.claude?.builtinTools).toBe("off");
    expect(config.providerOverrides?.codex?.builtinTools).toBe("on");
    expect(
      PersistedConfigSchema.safeParse({
        agents: { providers: { claude: { builtinTools: "none" } } },
      }).success,
    ).toBe(false);
  });

  test.each([
    ["non-JSON", "TOOL_SETTING"],
    ["a non-array", '{"TOOL_SETTING":true}'],
    ["a model credential", '["ANTHROPIC_API_KEY"]'],
    ["a proxy variable", '["https_proxy"]'],
    ["a prefix holding _PROXY", '["X_PROXY*"]'],
    ["a loader variable", '["LD_PRELOAD"]'],
    ["a harness config location", '["CODEX_HOME"]'],
  ])("rejects %s PASEO_MCP_GATEWAY_ENV_PASSTHROUGH", async (_name, value) => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-env-passthrough-bad-"));
    roots.push(paseoHome);

    expect(() =>
      loadConfig(paseoHome, { env: { PASEO_MCP_GATEWAY_ENV_PASSTHROUGH: value } }),
    ).toThrow("PASEO_MCP_GATEWAY_ENV_PASSTHROUGH");
  });

  test("refuses a persisted pass-through entry naming a model credential", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-env-passthrough-file-"));
    roots.push(paseoHome);
    const persisted = loadPersistedConfig(paseoHome);

    expect(() =>
      resolveConfigFromPersisted(
        paseoHome,
        { ...persisted, daemon: { mcp: { gateway: { envPassthrough: ["AWS_*"] } } } },
        { env: {} },
      ),
    ).toThrow("daemon.mcp.gateway.envPassthrough");
  });

  test.each([
    ["non-JSON", "claude=anthropic"],
    ["a non-object", '["anthropic"]'],
    ["an invalid provider id", '{"Claude":"anthropic"}'],
    ["an invalid backend name", '{"claude":"a/b"}'],
    ["a non-string backend", '{"claude":{"url":"http://x"}}'],
  ])("rejects %s PASEO_MCP_GATEWAY_MODEL_BACKENDS", async (_name, value) => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-model-gateway-bad-"));
    roots.push(paseoHome);

    expect(() =>
      loadConfig(paseoHome, { env: { PASEO_MCP_GATEWAY_MODEL_BACKENDS: value } }),
    ).toThrow("PASEO_MCP_GATEWAY_MODEL_BACKENDS");
  });

  test.each([
    ["non-JSON", "cluster=https://x"],
    ["a non-object", '["https://x"]'],
    ["a non-http URL", '{"cluster":"file:///etc/passwd"}'],
    ["an invalid backend name", '{"a/b":"https://x"}'],
    ["a backend object without a URL", '{"cluster":{"responseTimeoutMs":1000}}'],
    ["a backend object with an unknown key", '{"cluster":{"url":"https://x","timeout":1}}'],
    ["a zero response timeout", '{"cluster":{"url":"https://x","responseTimeoutMs":0}}'],
  ])("rejects %s PASEO_MCP_GATEWAY_BACKENDS", async (_name, value) => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-mcp-gateway-bad-"));
    roots.push(paseoHome);

    expect(() => loadConfig(paseoHome, { env: { PASEO_MCP_GATEWAY_BACKENDS: value } })).toThrow(
      "PASEO_MCP_GATEWAY_BACKENDS",
    );
  });

  const VALID_BACKEND_URLS = [
    "http://localhost",
    "https://cluster-mcp.example/mcp",
    "HTTPS://Cluster.Example/mcp?tenant=a&b=c",
    "http://127.0.0.1:9000/mcp",
    "http://10.0.0.1:65535/",
    "https://[::1]:8443/mcp",
    "http://[2001:db8::1]/",
    "http://[::ffff:192.0.2.1]/mcp",
    "http://svc.ns.svc.cluster.local:80/mcp/v1",
    "http://a.b-c.d/x%20y",
  ];
  const INVALID_BACKEND_URLS = [
    "http://",
    "https://",
    "https://[",
    "http:host",
    "http:/host",
    "http://user:pass@host/mcp",
    "http://user@host",
    "http://@host",
    "ftp://host",
    "file:///etc/hosts",
    "//host/mcp",
    "host/mcp",
    "http://host:99999",
    "http://host:65536",
    "http://host:port",
    "http://ho st",
    "http://host/mcp#frag",
    "http://999.1.1.1",
    "http://1.2.3.4.5",
    "http://-host",
    "http://host-",
    "http://host_name",
    "http://xn--bcher-kva.example",
    "http://a--b.example",
    "http://exa..mple",
    "http://host.",
    "http://[::g]",
    "http://[:::]",
    "http://[1::2::3]",
    "http://host\\mcp",
    " http://host",
    "http://host/a b",
  ];

  async function readPublishedGatewaySchema() {
    const schemaPath = path.resolve(
      import.meta.dirname,
      "../../../website/public/schemas/paseo.config.v1.json",
    );
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    return schema.definitions.PaseoConfigV1.properties.daemon.properties.mcp.properties.gateway
      .properties;
  }

  async function readPublishedBackendSchema() {
    return (await readPublishedGatewaySchema()).backends;
  }

  /** The published plain-URL form and the object form's `url` carry one pattern. */
  async function readPublishedBackendUrlPatterns(): Promise<RegExp[]> {
    const [plain, object] = (await readPublishedBackendSchema()).additionalProperties.anyOf;
    return [new RegExp(plain.pattern), new RegExp(object.properties.url.pattern)];
  }

  function persistedSchemaAccepts(backend: unknown): boolean {
    return PersistedConfigSchema.safeParse({
      daemon: { mcp: { gateway: { backends: { cluster: backend } } } },
    }).success;
  }

  function startupAccepts(backend: unknown): boolean {
    try {
      parseMcpGatewayBackends({ cluster: backend }, "backends");
      return true;
    } catch {
      return false;
    }
  }

  test.each([
    ...VALID_BACKEND_URLS.map((url) => [url, true] as const),
    ...INVALID_BACKEND_URLS.map((url) => [url, false] as const),
  ])(
    "startup, the persisted schema and the published schema agree on backend URL %j (%s)",
    async (url, valid) => {
      const publishedPatterns = await readPublishedBackendUrlPatterns();
      expect(isMcpGatewayBackendUrl(url)).toBe(valid);
      expect(startupAccepts(url)).toBe(valid);
      expect(persistedSchemaAccepts(url)).toBe(valid);
      expect(startupAccepts({ url })).toBe(valid);
      expect(persistedSchemaAccepts({ url })).toBe(valid);
      for (const pattern of publishedPatterns) {
        expect(pattern.test(url)).toBe(valid);
      }
    },
  );

  test.each([
    [1, true],
    [30_000, true],
    [600_000, true],
    [3_600_000, true],
    [0, false],
    [-1, false],
    [1.5, false],
    [3_600_001, false],
    ["1000", false],
    [null, false],
  ] as const)(
    "startup, the persisted schema and the published schema agree on responseTimeoutMs %j (%s)",
    async (responseTimeoutMs, valid) => {
      const backend = { url: "https://models.example/v1", responseTimeoutMs };
      const published = (await readPublishedBackendSchema()).additionalProperties.anyOf[1]
        .properties.responseTimeoutMs;
      const publishedAccepts =
        Number.isInteger(responseTimeoutMs) &&
        published.type === "integer" &&
        (responseTimeoutMs as number) >= published.minimum &&
        (responseTimeoutMs as number) <= published.maximum;
      expect(startupAccepts(backend)).toBe(valid);
      expect(persistedSchemaAccepts(backend)).toBe(valid);
      expect(publishedAccepts).toBe(valid);
    },
  );

  const ACCEPTED_PASSTHROUGH = [
    "TOOL_SETTING",
    "TOOLKIT_*",
    "IS_SANDBOX",
    "LC_ALL",
    "_PRIVATE",
    "PROXYISH_SETTING",
    "NODE_ENV",
    "LDAP_SERVER",
    "LDAP_*",
  ];
  const REFUSED_PASSTHROUGH = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
    "ANTHROPIC_*",
    "anthropic_api_key",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
    "CLAUDE_CODE_*",
    "CLAUDE_*",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "CODEX_API_KEY",
    "CODEX_*",
    "AWS_PROFILE",
    "AWS_*",
    "A*",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "CLOUDSDK_CONFIG",
    "CLOUD_ML_REGION",
    "VERTEX_REGION_CLAUDE",
    "AZURE_CLIENT_SECRET",
    "HTTP_PROXY",
    "http_proxy",
    "Http_Proxy",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "no_proxy",
    "FTP_PROXY",
    "CORP_PROXY",
    "HTTP*",
    "N*",
    "ANTHROPIC*",
    "X_PROXY*",
    "x_proxy_*",
    "TOOL_PROXY*",
    "LD*",
    "LD_*",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "ld_preload",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_*",
    "NODE_OPTIONS",
    "NODE_EXTRA_CA_CERTS",
    "NODE_*",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "SSL*",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "",
    "*",
    "1BAD",
    "BAD-NAME",
    "TOOL_*_X",
  ];

  test.each([
    ...ACCEPTED_PASSTHROUGH.map((entry) => [entry, true] as const),
    ...REFUSED_PASSTHROUGH.map((entry) => [entry, false] as const),
  ])(
    "startup, the persisted schema and the published schema agree on pass-through entry %j (%s)",
    async (entry, valid) => {
      const published = (await readPublishedGatewaySchema()).envPassthrough.items;
      const startup = (() => {
        try {
          parseMcpGatewayEnvPassthrough([entry], "envPassthrough");
          return true;
        } catch {
          return false;
        }
      })();
      expect(startup).toBe(valid);
      expect(
        PersistedConfigSchema.safeParse({
          daemon: { mcp: { gateway: { envPassthrough: [entry] } } },
        }).success,
      ).toBe(valid);
      expect(
        new RegExp(published.pattern).test(entry) && !new RegExp(published.not.pattern).test(entry),
      ).toBe(valid);
    },
  );

  test("the published pass-through patterns are the daemon's own", async () => {
    const published = (await readPublishedGatewaySchema()).envPassthrough.items;
    expect(published.pattern).toBe(MCP_GATEWAY_ENV_PASSTHROUGH_ENTRY_PATTERN_SOURCE);
    expect(published.not.pattern).toBe(MCP_GATEWAY_REFUSED_ENV_PASSTHROUGH_PATTERN_SOURCE);
  });

  test("startup, the persisted schema and the published schema agree on model gateway entries", async () => {
    const published = (await readPublishedGatewaySchema()).modelBackends;
    const providerPattern = new RegExp(published.propertyNames.pattern);
    const backendPattern = new RegExp(published.additionalProperties.pattern);
    for (const [provider, backend, valid] of [
      ["claude", "anthropic", true],
      ["codex-work", "openai.v1", true],
      ["Claude", "anthropic", false],
      ["1claude", "anthropic", false],
      ["claude", "-anthropic", false],
      ["claude", "a/b", false],
      ["claude", "", false],
    ] as const) {
      const startup = (() => {
        try {
          parseMcpGatewayModelBackends({ [provider]: backend }, "modelBackends");
          return true;
        } catch {
          return false;
        }
      })();
      expect(startup).toBe(valid);
      expect(
        PersistedConfigSchema.safeParse({
          daemon: { mcp: { gateway: { modelBackends: { [provider]: backend } } } },
        }).success,
      ).toBe(valid);
      expect(providerPattern.test(provider) && backendPattern.test(backend)).toBe(valid);
      expect(
        MCP_GATEWAY_MODEL_PROVIDER_PATTERN.test(provider) &&
          MCP_GATEWAY_BACKEND_NAME_PATTERN.test(backend),
      ).toBe(valid);
    }
  });

  test.each(VALID_BACKEND_URLS)(
    "an accepted backend URL %j parses with its host and no credentials",
    (url) => {
      const parsed = new URL(url);
      expect(["http:", "https:"]).toContain(parsed.protocol);
      expect(parsed.hostname).not.toBe("");
      expect(parsed.username).toBe("");
      expect(parsed.password).toBe("");
      expect(parsed.hash).toBe("");
    },
  );

  test("startup, the persisted schema and the published schema agree on backend names", async () => {
    const published = await readPublishedBackendSchema();
    const namePattern = new RegExp(published.propertyNames.pattern);
    for (const [name, valid] of [
      ["cluster", true],
      ["c.1_x-y", true],
      ["-cluster", false],
      ["a/b", false],
      ["", false],
    ] as const) {
      expect(namePattern.test(name)).toBe(valid);
      expect(MCP_GATEWAY_BACKEND_NAME_PATTERN.test(name)).toBe(valid);
      expect(
        PersistedConfigSchema.safeParse({
          daemon: { mcp: { gateway: { backends: { [name]: "http://host" } } } },
        }).success,
      ).toBe(valid);
    }
  });

  test("rejects a persisted MCP gateway backend that is not an http URL", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-mcp-gateway-file-"));
    roots.push(paseoHome);
    const persisted = loadPersistedConfig(paseoHome);

    expect(() =>
      resolveConfigFromPersisted(
        paseoHome,
        {
          ...persisted,
          daemon: { mcp: { gateway: { backends: { cluster: "ftp://cluster.example" } } } },
        },
        { env: {} },
      ),
    ).toThrow("daemon.mcp.gateway.backends");
  });

  test("resolves bundled web UI path from source-tree modules", () => {
    const root = path.parse(process.cwd()).root;
    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(
          path.join(root, "repo", "packages", "server", "src", "server", "config.ts"),
        ),
      }),
    ).toBe(path.join(root, "repo", "packages", "server", "dist", "server", "web-ui"));
  });

  test("resolves bundled web UI path from globally installed compiled modules", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-config-compiled-"));
    roots.push(packageRoot);
    await mkdir(path.join(packageRoot, "dist", "server", "web-ui"), { recursive: true });

    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(path.join(packageRoot, "dist", "server", "server", "config.js")),
      }),
    ).toBe(path.join(packageRoot, "dist", "server", "web-ui"));
  });

  test("resolves packaged desktop web UI path from resources app-dist", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-config-packaged-"));
    roots.push(packageRoot);
    await mkdir(path.join(packageRoot, "app-dist"), { recursive: true });

    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(
          path.join(
            packageRoot,
            "app.asar",
            "node_modules",
            "@getpaseo",
            "server",
            "dist",
            "server",
            "server",
            "config.js",
          ),
        ),
        resourcesPath: packageRoot,
      }),
    ).toBe(path.join(packageRoot, "app-dist"));
  });
});
