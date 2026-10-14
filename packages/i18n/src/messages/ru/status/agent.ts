import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Запись в {path} — за пределами рабочего пространства агента, общей папки и временных папок.",
  "status.agent.contextCleared": "Контекст очищен. Здесь начинается новый чат.",
  "status.agent.modelSwitchedForLimit": "Лимит использования исчерпан. Переключено на {model}.",
  "status.agent.modelReturnedAfterLimit": "Лимит использования закончился. Снова используется {model}.",
  "status.agent.marketplaceSuggested": "Предложено приложение из каталога: {app}.",
} as const satisfies PartialTranslation<typeof source>;
