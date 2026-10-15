// Link-only agent templates: publishing a local agent, and previewing and installing a shared one.

import { runCauseEffect } from "../../backend/effect-boundary";
import type { AgentTemplateService } from "../agent-template-service";
import { parseInstallAgentTemplate, parsePublishAgentTemplate } from "./agent-template-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

export { parseInstallAgentTemplate, parsePublishAgentTemplate } from "./agent-template-inputs";

export interface AgentTemplateIpcDependencies {
  agentTemplates: AgentTemplateService;
  /** The id of an agent link that arrived before a window could be told, taken exactly once. */
  takePendingLink: () => string | null;
}

/**
 * There is no endpoint that installs from a link. A link names a template; installing it is still
 * a press of Install in the dialog that shows its content.
 */
export function agentTemplateIpcHandlers({
  agentTemplates,
  takePendingLink,
}: AgentTemplateIpcDependencies): Pick<IpcGroupHandlers, "agentTemplates"> {
  return {
    agentTemplates: {
      preview: payloadHandler(stringPayload("agentId"), (agentId) => runCauseEffect(agentTemplates.preview(agentId))),
      publish: payloadHandler(parsePublishAgentTemplate, (input) => runCauseEffect(agentTemplates.publish(input))),
      unpublish: payloadHandler(stringPayload("agentId"), (agentId) =>
        runCauseEffect(agentTemplates.unpublish(agentId)),
      ),
      get: payloadHandler(stringPayload("templateId"), (templateId) => runCauseEffect(agentTemplates.get(templateId))),
      install: payloadHandler(parseInstallAgentTemplate, (input) => runCauseEffect(agentTemplates.install(input))),
      takePendingLink: handler(takePendingLink),
    },
  };
}
