import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import type { DaemonServerInfo } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";

export type HostFeatureName = keyof NonNullable<DaemonServerInfo["features"]>;

export interface HostFeatureSessionState {
  sessions: Record<
    string,
    | {
        serverInfo: DaemonServerInfo | null;
      }
    | undefined
  >;
}

export function hostSupportsFeature(
  serverInfo: DaemonServerInfo | null | undefined,
  feature: HostFeatureName,
): boolean {
  return serverInfo?.features?.[feature] === true;
}

export function selectHostFeature(
  state: HostFeatureSessionState,
  serverId: string,
  feature: HostFeatureName,
): boolean {
  return hostSupportsFeature(state.sessions[serverId]?.serverInfo, feature);
}

interface AgentCreationSessionState {
  sessions: Record<
    string,
    | {
        serverInfo: DaemonServerInfo | null;
        agents: ReadonlyMap<string, { archivedAt?: Date | null }>;
      }
    | undefined
  >;
}

/**
 * A single-agent host refuses a second live agent, so every way of starting
 * one is withdrawn once it has a live agent.
 */
export function selectAgentCreationBlocked(
  state: AgentCreationSessionState,
  serverId: string,
): boolean {
  const session = state.sessions[serverId];
  if (!hostSupportsFeature(session?.serverInfo, "singleAgent")) return false;
  for (const agent of session?.agents.values() ?? []) {
    if (!agent.archivedAt) return true;
  }
  return false;
}

export function useAgentCreationBlocked(serverId: string | null | undefined): boolean {
  const normalizedServerId = serverId?.trim() ?? "";
  return useSessionStore((state) => selectAgentCreationBlocked(state, normalizedServerId));
}

export function useHostFeature(
  serverId: string | null | undefined,
  feature: HostFeatureName,
): boolean {
  const normalizedServerId = serverId?.trim() ?? "";
  return useSessionStore((state) => selectHostFeature(state, normalizedServerId, feature));
}

export function useHostFeatureMap(
  serverIds: readonly string[],
  feature: HostFeatureName,
): ReadonlyMap<string, boolean> {
  const flags = useSessionStore(
    useShallow((state) => serverIds.map((serverId) => selectHostFeature(state, serverId, feature))),
  );

  return useMemo(
    () => new Map(serverIds.map((serverId, index) => [serverId, flags[index] === true] as const)),
    [flags, serverIds],
  );
}

export function useHostFeatureAvailabilityMap(
  serverIds: readonly string[],
  feature: HostFeatureName,
): ReadonlyMap<string, boolean | null> {
  const flags = useSessionStore(
    useShallow((state) =>
      serverIds.map((serverId) => {
        const serverInfo = state.sessions[serverId]?.serverInfo;
        return serverInfo ? hostSupportsFeature(serverInfo, feature) : null;
      }),
    ),
  );

  return useMemo(
    () => new Map(serverIds.map((serverId, index) => [serverId, flags[index]] as const)),
    [flags, serverIds],
  );
}
