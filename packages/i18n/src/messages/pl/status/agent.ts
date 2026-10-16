import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Zapis {path} poza obszarem roboczym agenta, folderem współdzielonym i folderami tymczasowymi.",
  "status.agent.contextCleared": "Kontekst wyczyszczony. Tutaj zaczyna się nowy czat.",
  "status.agent.modelSwitchedForLimit": "Osiągnięto limit użycia. Przełączono na {model}.",
  "status.agent.modelReturnedAfterLimit": "Limit użycia już nie obowiązuje. Przełączono z powrotem na {model}.",
  "status.agent.marketplaceSuggested": "Zaproponowano aplikację z Marketplace: {app}.",
  "status.agent.screenCaptureScreen": "Przechwyć główny ekran i wyślij obraz do modelu agenta.",
  "status.agent.screenCaptureDisplay": "Przechwyć wyświetlacz {name} i wyślij obraz do modelu agenta.",
  "status.agent.screenCaptureWindow": "Przechwyć okno {name} i wyślij obraz do modelu agenta.",
  "status.agent.screenCaptureRegion":
    "Przechwyć obszar ekranu w punkcie {x}, {y} o rozmiarze {width} × {height} punktów i wyślij obraz do modelu agenta.",
  "status.agent.screenCaptureProgress": "Prośba o przechwycenie ekranu…",
  "status.agent.screenCaptureReviewing": "Sprawdzanie przechwyconego ekranu…",
} as const satisfies PartialTranslation<typeof source>;
