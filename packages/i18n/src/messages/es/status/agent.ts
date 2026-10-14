import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Escribir en {path}, fuera del espacio de trabajo del agente, la carpeta compartida y las carpetas temporales.",
  "status.agent.contextCleared": "Contexto borrado. Aquí empieza un nuevo chat.",
  "status.agent.modelSwitchedForLimit": "Límite de uso alcanzado. Se cambió a {model}.",
  "status.agent.modelReturnedAfterLimit": "El límite de uso terminó. Se volvió a {model}.",
  "status.agent.marketplaceSuggested": "Se sugirió una aplicación de Marketplace: {app}.",
} as const satisfies PartialTranslation<typeof source>;
