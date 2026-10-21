import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Écrire {path}, hors de l’espace de travail de l’agent, du dossier partagé et des dossiers temporaires.",
  "status.agent.contextCleared": "Contexte effacé. Une nouvelle discussion commence ici.",
  "status.agent.modelSwitchedForLimit": "Limite d’utilisation atteinte. Passage à {model}.",
  "status.agent.modelReturnedAfterLimit": "Limite d’utilisation terminée. Retour à {model}.",
  "status.agent.marketplaceSuggested": "Application de la Marketplace suggérée : {app}.",
  "status.agent.screenCaptureScreen": "Capturer l’écran principal et envoyer l’image au modèle de l’agent.",
  "status.agent.screenCaptureChannel":
    "L’image s’affiche dans le canal {channel}, et chaque membre de ce serveur qui lit le canal peut la voir.",
  "status.agent.screenCaptureDisplay": "Capturer l’écran {name} et envoyer l’image au modèle de l’agent.",
  "status.agent.screenCaptureWindow": "Capturer la fenêtre {name} et envoyer l’image au modèle de l’agent.",
  "status.agent.screenCaptureRegion":
    "Capturer la zone de l’écran à {x}, {y}, {width} × {height} points et envoyer l’image au modèle de l’agent.",
  "status.agent.screenCaptureProgress": "Demande de capture d’écran…",
  "status.agent.screenCaptureReviewing": "Analyse de la capture d’écran…",
} as const satisfies PartialTranslation<typeof source>;
