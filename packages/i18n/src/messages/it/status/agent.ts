import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Scrittura di {path}, fuori dal workspace dell'agente, dalla cartella condivisa e dalle cartelle temporanee.",
  "status.agent.contextCleared": "Contesto cancellato. Da qui inizia una nuova chat.",
  "status.agent.modelSwitchedForLimit": "Limite di utilizzo raggiunto. Passato a {model}.",
  "status.agent.modelReturnedAfterLimit": "Limite di utilizzo terminato. Tornato a {model}.",
  "status.agent.marketplaceSuggested": "Ha suggerito un'app del Marketplace: {app}.",
  "status.agent.screenCaptureScreen":
    "Acquisizione dello schermo principale e invio dell'immagine al modello dell'agente.",
  "status.agent.screenCaptureChannel":
    "L'immagine appare nel canale {channel} e ogni membro di questo server che legge il canale può vederla.",
  "status.agent.screenCaptureDisplay":
    "Acquisizione dello schermo {name} e invio dell'immagine al modello dell'agente.",
  "status.agent.screenCaptureWindow":
    "Acquisizione della finestra {name} e invio dell'immagine al modello dell'agente.",
  "status.agent.screenCaptureRegion":
    "Acquisizione dell'area dello schermo a {x}, {y}, {width} × {height} punti e invio dell'immagine al modello dell'agente.",
  "status.agent.screenCaptureProgress": "Richiesta di acquisizione dello schermo…",
  "status.agent.screenCaptureReviewing": "Analisi dell'acquisizione dello schermo…",
} as const satisfies PartialTranslation<typeof source>;
