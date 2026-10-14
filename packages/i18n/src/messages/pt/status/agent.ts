import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Gravar em {path}, fora do espaço de trabalho do agente, da pasta compartilhada e das pastas temporárias.",
  "status.agent.contextCleared": "Contexto limpo. Um novo chat começa aqui.",
  "status.agent.modelSwitchedForLimit": "Limite de uso atingido. Trocou para {model}.",
  "status.agent.modelReturnedAfterLimit": "O limite de uso terminou. Voltou para {model}.",
  "status.agent.marketplaceSuggested": "App do Marketplace sugerido: {app}.",
} as const satisfies PartialTranslation<typeof source>;
