import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  YEET_CODE_GATEWAY_TOKEN_ENV,
  YEET_CODE_GATEWAY_URL_ENV,
  YeetCodeAgentClient,
  YeetCodeProviderParamsSchema,
  __yeetCodeInternals,
} from "./yeet-code-agent.js";

const CONNECTION_FACTORY = async () => {
  throw new Error("not used");
};

describe("YeetCodeAgentClient", () => {
  test("resolves the endpoint and bearer from typed provider configuration", () => {
    const endpoint = __yeetCodeInternals.resolveEndpoint({
      logger: createTestLogger(),
      providerParams: {
        url: "https://gateway.example.test/acp",
        tokenEnv: "YEET_CODE_TEST_TOKEN",
      },
      runtimeSettings: { env: { YEET_CODE_TEST_TOKEN: "gateway-secret" } },
      processEnv: {},
      connectionFactory: CONNECTION_FACTORY,
    });
    expect(endpoint).toEqual({
      endpoint: "https://gateway.example.test/acp",
      bearerToken: "gateway-secret",
    });
  });

  test("supports environment-only configuration and never includes secrets in diagnostics", async () => {
    const client = new YeetCodeAgentClient({
      logger: createTestLogger(),
      processEnv: {
        [YEET_CODE_GATEWAY_URL_ENV]: "http://127.0.0.1:18445/acp",
        [YEET_CODE_GATEWAY_TOKEN_ENV]: "do-not-print-this",
      },
      connectionFactory: CONNECTION_FACTORY,
    });
    const diagnostic = await client.getDiagnostic();
    expect(diagnostic.diagnostic).not.toContain("do-not-print-this");
    expect(diagnostic.diagnostic).toContain("not used");
  });

  test("fails closed for unknown params and missing runtime configuration", async () => {
    expect(() => YeetCodeProviderParamsSchema.parse({ unknown: true })).toThrow();
    const client = new YeetCodeAgentClient({
      logger: createTestLogger(),
      processEnv: {},
    });
    expect(await client.isAvailable()).toBe(false);
    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/project", force: true }),
    ).rejects.toThrow(`Provider 'yeet-code' requires`);
  });
});
