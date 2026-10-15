import {
  type InstallAgentTemplateInput,
  isAgentTemplateCardPng,
  type PublishAgentTemplateInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { isObject, requireString } from "./validation";

export function parseInstallAgentTemplate(input: unknown): InstallAgentTemplateInput {
  if (!isObject(input)) throw new Error("Invalid agent installation.");
  return {
    templateId: requireString(input.templateId, "templateId"),
    timezone: requireString(input.timezone, "timezone", 255),
    expectedUpdatedAt: requireString(input.expectedUpdatedAt, "expectedUpdatedAt", 64),
  };
}

export function parsePublishAgentTemplate(input: unknown): PublishAgentTemplateInput {
  if (!isObject(input)) throw new Error("Invalid agent publication.");
  const card = input.card;
  if (card !== null && !(card instanceof Uint8Array && isAgentTemplateCardPng(card)))
    throw new Error(sourceText("error.marketplace.shareCardInvalid"));
  return { agentId: requireString(input.agentId, "agentId"), card };
}
