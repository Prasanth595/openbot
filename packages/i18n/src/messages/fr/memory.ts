import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/memory";

export const messages = {
  "memory.title": "Souvenirs",
  "memory.description": "Souvenirs enregistrés pour {name}",
  "memory.add": "Ajouter un souvenir",
  "memory.close": "Fermer les souvenirs",
  "memory.new": "Nouveau souvenir",
  "memory.newPlaceholder": "Ajoutez un fait ou une préférence durable",
  "memory.save": "Enregistrer le souvenir",
  "memory.limitAgent":
    "Cet agent a atteint la limite de {limit} souvenirs. Modifiez, fusionnez ou supprimez un souvenir avant d’en ajouter un autre.",
  "memory.limitChannel":
    "Ce canal a atteint la limite de {limit} souvenirs. Modifiez, fusionnez ou supprimez un souvenir avant d’en ajouter un autre.",
  "memory.loading": "Chargement des souvenirs…",
  "memory.emptyAgent": "Cet agent n’a encore aucun souvenir enregistré.",
  "memory.emptyChannel": "Ce canal n’a encore aucun souvenir enregistré.",
  "memory.editText": "Modifier le souvenir : {text}",
  "memory.edit": "Modifier le souvenir",
  "memory.delete": "Supprimer le souvenir",
  "memory.learned": "Appris automatiquement",
  "memory.manual": "Ajouté manuellement",
  "memory.unknownDate": "Date inconnue",
  "memory.clearAll": "Effacer tous les souvenirs",
  "memory.clearTitle": "Effacer tous les souvenirs ?",
  "memory.clearDescription":
    "OpenBot va supprimer définitivement les {total} souvenirs enregistrés pour {name}. Les messages d’origine resteront dans l’historique de la conversation.",

  "memory.loadFailed": "Impossible de charger les souvenirs.",
  "memory.saveFailed": "Impossible d’enregistrer le souvenir.",
  "memory.updateFailed": "Impossible de mettre à jour le souvenir.",
  "memory.deleteFailed": "Impossible de supprimer le souvenir.",
  "memory.clearFailed": "Impossible d’effacer les souvenirs.",
  "memory.inclusion.label": "Utilisation du souvenir",
  "memory.inclusion.essential": "Toujours inclus",
  "memory.inclusion.searchable": "Rechercher au besoin",
  "memory.inclusion.automatic": "Laisser l’agent décider",
  "memory.inclusion.userControlled": "Sélectionné par vous",
  "memory.inclusion.agentControlled": "L’agent peut modifier ce choix",
  "memory.inclusion.explanation":
    "Tous les souvenirs restent enregistrés. Seuls les souvenirs essentiels entrent dans chaque prompt. L’agent peut rechercher les autres.",
  "memory.inclusion.capacity": "Capacité des souvenirs essentiels : {used} sur {total}",
  "memory.directory.label": "Libellés de recherche",
  "memory.directory.explanation": "Ces libellés aident l’agent à chercher. Ils ne sont pas inclus dans chaque requête.",
  "memory.directory.title": "Titre court",
  "memory.directory.aliases": "Alias",
  "memory.directory.aliasHelp": "Jusqu’à quatre alias littéraux, un par ligne. Aucune traduction ni déduction de sens.",
  "memory.directory.fallback": "Le texte actuel sert d’indice. Enregistrez des libellés pour cette version.",
  "memory.directory.userLabels":
    "Enregistrés par vous. Les modifications automatiques ne peuvent pas remplacer ces libellés.",
  "memory.directory.agentLabels": "Enregistrés par l’agent.",
  "memory.directory.save": "Enregistrer les libellés",
  "memory.directory.remove": "Retirer les libellés personnalisés",
  "memory.directory.reload": "Recharger les libellés",
  "memory.directory.loading": "Chargement des libellés…",
  "memory.directory.loadFailed": "Impossible de charger les libellés.",
  "memory.directory.saveFailed": "Impossible d’enregistrer les libellés.",
  "memory.directory.invalid":
    "96 caractères maximum pour le titre et quatre alias de 64 caractères chacun. 512 octets maximum au total.",
} as const satisfies PartialTranslation<typeof source>;
