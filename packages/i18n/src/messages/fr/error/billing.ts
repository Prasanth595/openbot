import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "L’offre du serveur n’a pas pu être modifiée. Actualisez Facturation et réessayez.",
  "error.billing.confirmMismatch": "Saisissez le nom du serveur pour le supprimer.",
  "error.billing.restartBusy": "Le serveur ne peut pas redémarrer maintenant. Réessayez dans une minute.",
  "error.billing.planRequired": "L’offre de ce serveur a pris fin. Renouvelez-la pour démarrer le serveur.",
  // Billing errors.
  "error.billing.invalidRequest": "La demande de facturation n’est pas valide.",
  "error.billing.invalidResponse": "La réponse de facturation n’est pas valide.",
  "error.billing.notStripePage": "La page de facturation n’est pas une page Stripe.",
} as const satisfies PartialTranslation<typeof source>;
