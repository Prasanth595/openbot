import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { HostService } from "../host-service";
import {
  parseConversationAction,
  parseConversationCreate,
  parseConversationList,
  parseConversationRead,
  parseConversationSearch,
  parseConversationSend,
  parseConversationUpdate,
} from "./agent-conversation-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

interface AgentConversationIpcDependencies {
  service: AgentService;
  host: HostService;
}
export function agentConversationIpcHandlers({
  service,
  host,
}: AgentConversationIpcDependencies): Pick<IpcGroupHandlers, "agentConversations"> {
  return {
    agentConversations: {
      list: payloadHandler(parseConversationList, (input) => runCauseEffect(service.userConversations.list(input))),
      create: payloadHandler(parseConversationCreate, (input) =>
        runCauseEffect(service.userConversations.create(input)),
      ),
      update: payloadHandler(parseConversationUpdate, (input) =>
        runCauseEffect(service.userConversations.update(input)),
      ),
      read: payloadHandler(parseConversationRead, (input) =>
        runCauseEffect(service.userConversations.read(input, host.conversationReaderId())),
      ),
      queue: payloadHandler(parseConversationRead, (input) => service.userConversations.queue(input)),
      search: payloadHandler(parseConversationSearch, (input) => service.userConversations.search(input)),
      send: payloadHandler(parseConversationSend, (input) =>
        runCauseEffect(service.userConversations.send(input, host.conversationSender())),
      ),
      action: payloadHandler(parseConversationAction, (input) =>
        runCauseEffect(service.userConversations.action(input, host.conversationReaderId(), host.conversationSender())),
      ),
    },
  };
}
