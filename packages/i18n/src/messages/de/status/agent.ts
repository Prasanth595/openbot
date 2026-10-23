import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "In {path} schreiben, außerhalb des Agentenarbeitsbereichs, des geteilten Ordners und der temporären Ordner.",
  "status.agent.contextCleared": "Kontext geleert. Hier beginnt ein neuer Chat.",
  "status.agent.modelSwitchedForLimit": "Nutzungslimit erreicht. Zu {model} gewechselt.",
  "status.agent.modelReturnedAfterLimit": "Nutzungslimit beendet. Zurück zu {model} gewechselt.",
  "status.agent.marketplaceSuggested": "Eine Marketplace-App wurde vorgeschlagen: {app}.",
  "status.agent.channelMemberAdded": "{agent} hat {member} zum Kanal hinzugefügt. {person} hat darum gebeten.",
  "status.agent.channelMemberRemoved": "{agent} hat {member} aus dem Kanal entfernt. {person} hat darum gebeten.",
  "status.agent.channelInstructionsChanged":
    "{agent} hat die Anweisungen des Kanals geändert. {person} hat darum gebeten.",
  "status.agent.channelRoutineCreated": "{agent} hat die Routine {routine} erstellt. {person} hat darum gebeten.",
  "status.agent.channelRoutineUpdated": "{agent} hat die Routine {routine} geändert. {person} hat darum gebeten.",
  "status.agent.channelRoutineDeleted": "{agent} hat die Routine {routine} gelöscht. {person} hat darum gebeten.",
  "status.agent.screenCaptureScreen": "Den Hauptbildschirm aufnehmen und das Bild an das Modell des Agenten senden.",
  "status.agent.screenCaptureChannel":
    "Das Bild erscheint im Kanal {channel}, und jedes Mitglied dieses Servers, das den Kanal liest, kann es sehen.",
  "status.agent.screenCaptureDisplay": "Den Bildschirm {name} aufnehmen und das Bild an das Modell des Agenten senden.",
  "status.agent.screenCaptureWindow": "Das Fenster {name} aufnehmen und das Bild an das Modell des Agenten senden.",
  "status.agent.screenCaptureRegion":
    "Den Bildschirmbereich bei {x}, {y}, {width} × {height} Punkten aufnehmen und das Bild an das Modell des Agenten senden.",
  "status.agent.screenCaptureProgress": "Bildschirmaufnahme wird angefragt…",
  "status.agent.screenCaptureReviewing": "Bildschirmaufnahme wird geprüft…",
} as const satisfies PartialTranslation<typeof source>;
