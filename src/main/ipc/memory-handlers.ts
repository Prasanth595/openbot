import { MEMORY_DIRECTORY_CAPABILITY } from "@openbot/contracts/team-protocol/memory-directory-v1";
import {
  readAgentMemoryDirectoryMetadata,
  setAgentMemoryDirectoryMetadata,
} from "@openbot/team-client/memory-directory-requests";
import { decodeMemoryDirectoryMetadataFromHost } from "../remote-memory-directory-decoding";
import { parseGetAgentMemoryDirectory, parseSetAgentMemoryDirectory } from "./memory-directory-inputs";
// An agent's long-lived memories: the notes it carries between threads.

import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_MEMORIES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-memories-v1";
import {
  readAgentMemories,
  readAgentMemorySelection,
  setAgentMemoryInclusion,
} from "@openbot/team-client/team-api-requests";
import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import { decodeAgentMemory } from "../remote-agent-decoding";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import {
  parseAgentId,
  parseCreateAgentMemory,
  parseDeleteAgentMemory,
  parseSetAgentMemoryInclusion,
  parseUpdateAgentMemory,
} from "./agent-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler } from "./scoped-handler";

interface MemoryIpcDependencies {
  service: AgentService;
  remoteServers: RemoteServerManager;
}

export function memoryIpcHandlers({
  service,
  remoteServers,
}: MemoryIpcDependencies): Pick<IpcGroupHandlers, "agentMemories"> {
  return {
    agentMemories: {
      getMemoryDirectoryMetadata: scopedHandler(parseGetAgentMemoryDirectory, {
        local: (input) => service.getMemoryDirectoryMetadata(input),
        remote: (input, serverId) =>
          runCauseEffect(
            readAgentMemoryDirectoryMetadata(
              (method, path, decode, body) => remoteServers.request(serverId, path, decode, { method, body }),
              input,
              remoteServers.supportsCapability(serverId, MEMORY_DIRECTORY_CAPABILITY),
              decodeMemoryDirectoryMetadataFromHost,
            ),
          ),
      }),
      setMemoryDirectoryMetadata: scopedHandler(parseSetAgentMemoryDirectory, {
        local: (input) => service.setMemoryDirectoryMetadata(input),
        remote: (input, serverId) =>
          runCauseEffect(
            setAgentMemoryDirectoryMetadata(
              (method, path, decode, body) => remoteServers.request(serverId, path, decode, { method, body }),
              input,
              decodeMemoryDirectoryMetadataFromHost,
            ),
          ),
      }),
      getMemorySelection: scopedHandler(parseAgentId, {
        local: (agentId) => service.getMemorySelection(agentId),
        remote: (agentId, serverId) =>
          runCauseEffect(
            readAgentMemorySelection(
              (method, path, decode, body) => remoteServers.request(serverId, path, decode, { method, body }),
              agentId,
              remoteServers.supportsCapability(serverId, AGENT_MEMORIES_CAPABILITY),
            ),
          ),
      }),
      setMemoryInclusion: scopedHandler(parseSetAgentMemoryInclusion, {
        local: (input) => service.setMemoryInclusion(input),
        remote: (input, serverId) =>
          runCauseEffect(
            setAgentMemoryInclusion(
              (method, path, decode, body) => remoteServers.request(serverId, path, decode, { method, body }),
              input,
            ),
          ),
      }),
      listMemories: scopedHandler(parseAgentId, {
        local: (agentId) => service.listMemories(agentId),
        remote: (agentId, serverId) =>
          runCauseEffect(
            readAgentMemories(
              (method, path, decode, body) => remoteServers.request(serverId, path, decode, { method, body }),
              agentId,
              remoteServers.supportsCapability(serverId, AGENT_MEMORIES_CAPABILITY),
            ),
          ),
      }),
      createMemory: scopedHandler(parseCreateAgentMemory, {
        local: (parsed) => service.createMemory(parsed),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.memories(parsed.agentId), decodeAgentMemory, {
              method: "POST",
              body: { text: parsed.text },
            }),
          ),
      }),
      updateMemory: scopedHandler(parseUpdateAgentMemory, {
        local: (parsed) => service.updateMemory(parsed),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(
              serverId,
              TEAM_API_ROUTES.agent.memory(parsed.agentId, parsed.memoryId),
              decodeAgentMemory,
              {
                method: "PATCH",
                body: { text: parsed.text },
              },
            ),
          ),
      }),
      deleteMemory: scopedHandler(parseDeleteAgentMemory, {
        local: (parsed) => service.deleteMemory(parsed),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.memory(parsed.agentId, parsed.memoryId), decodeVoid, {
              method: "DELETE",
            }),
          ),
      }),
      clearMemories: scopedHandler(parseAgentId, {
        local: (agentId) => service.clearMemories(agentId),
        remote: (agentId, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.memories(agentId), decodeVoid, { method: "DELETE" }),
          ),
      }),
    },
  };
}
