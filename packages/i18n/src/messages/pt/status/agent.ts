import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Gravar em {path}, fora do espaço de trabalho do agente, da pasta compartilhada e das pastas temporárias.",
  "status.agent.contextCleared": "Contexto limpo. Um novo chat começa aqui.",
  "status.agent.modelSwitchedForLimit": "Limite de uso atingido. O modelo mudou para {model}.",
  "status.agent.modelReturnedAfterLimit": "O limite de uso terminou. O modelo voltou para {model}.",
  "status.agent.marketplaceSuggested": "App da loja sugerido: {app}.",
  "status.agent.screenCaptureScreen": "Capturar a tela principal e enviar a imagem ao modelo do agente.",
  "status.agent.screenCaptureChannel":
    "A imagem aparece no canal {channel}, e cada membro deste servidor que lê o canal pode vê-la.",
  "status.agent.screenCaptureDisplay": "Capturar o monitor {name} e enviar a imagem ao modelo do agente.",
  "status.agent.screenCaptureWindow": "Capturar a janela {name} e enviar a imagem ao modelo do agente.",
  "status.agent.screenCaptureRegion":
    "Capturar a área da tela em {x}, {y}, {width} × {height} pontos e enviar a imagem ao modelo do agente.",
  "status.agent.screenCaptureProgress": "Pedindo para capturar a tela…",
  "status.agent.screenCaptureReviewing": "Analisando a captura de tela…",
} as const satisfies PartialTranslation<typeof source>;
