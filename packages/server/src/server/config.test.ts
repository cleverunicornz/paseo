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
  parseMcpGatewayBackends,
} from "./mcp-gateway/backends.js";

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

    expect(fromFile.mcpGatewayBackends).toEqual({ cluster: "https://cluster-mcp.example/mcp" });
    expect(fromFile.configReload?.overrideControlledPaths).not.toContain(
      "daemon.mcp.gateway.backends",
    );
    expect(fromEnv.mcpGatewayBackends).toEqual({ docs: "http://127.0.0.1:9000/mcp" });
    expect(fromEnv.configReload?.overrideControlledPaths).toContain("daemon.mcp.gateway.backends");
  });

  test.each([
    ["non-JSON", "cluster=https://x"],
    ["a non-object", '["https://x"]'],
    ["a non-http URL", '{"cluster":"file:///etc/passwd"}'],
    ["an invalid backend name", '{"a/b":"https://x"}'],
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
    "http://exa..mple",
    "http://host.",
    "http://[::g]",
    "http://[:::]",
    "http://[1::2::3]",
    "http://host\\mcp",
    " http://host",
    "http://host/a b",
  ];

  async function readPublishedBackendSchema() {
    const schemaPath = path.resolve(
      import.meta.dirname,
      "../../../website/public/schemas/paseo.config.v1.json",
    );
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    return schema.definitions.PaseoConfigV1.properties.daemon.properties.mcp.properties.gateway
      .properties.backends;
  }

  function persistedSchemaAccepts(url: string): boolean {
    return PersistedConfigSchema.safeParse({
      daemon: { mcp: { gateway: { backends: { cluster: url } } } },
    }).success;
  }

  function startupAccepts(url: string): boolean {
    try {
      parseMcpGatewayBackends({ cluster: url }, "backends");
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
      const published = await readPublishedBackendSchema();
      expect(isMcpGatewayBackendUrl(url)).toBe(valid);
      expect(startupAccepts(url)).toBe(valid);
      expect(persistedSchemaAccepts(url)).toBe(valid);
      expect(new RegExp(published.additionalProperties.pattern).test(url)).toBe(valid);
    },
  );

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
