import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, onCleanup, onSettled, Show, untrack } from "solid-js";
import { App } from "../App";
import { useAgents } from "../features/agents/agents-context";
import { useLayout } from "../layout";
import { useNavigation } from "../navigation";
import { setSendShortcutMode, useSendShortcutMode } from "../send-shortcut-preference";
import { createUseCaseOptions, MARKETING_DEMO_MANIFEST, type PreviewUseCaseAction } from "./marketing-demo-manifest";
import { createMockOpenBot, type MockOpenBotControls } from "./mock-openbot";
import { OpenBotPlayground } from "./OpenBotPlayground";

export function MarketingDemoSession(props: { onReset: () => void; onExit?: () => void }) {
  const mock = createMockOpenBot(createUseCaseOptions(MARKETING_DEMO_MANIFEST));
  return (
    <OpenBotPlayground
      dependencies={{
        createMock: () => mock,
        renderApp: () => (
          <App
            landingPreview
            voiceInputEnabled={false}
            previewControls={() => <MarketingDemoGuide mock={mock} onReset={props.onReset} onExit={props.onExit} />}
          />
        ),
      }}
    />
  );
}

function MarketingDemoGuide(props: { mock: MockOpenBotControls; onReset: () => void; onExit?: () => void }) {
  const { t } = useText();
  const { activeAgentId } = useAgents();
  const { selectAgent } = useNavigation();
  const layout = useLayout();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let disposed = false;
  const previousShortcut = untrack(useSendShortcutMode());
  const unsubscribe = props.mock.api.agent.onEvent((event) => {
    if (event.type === "turn-started") setBusy(true);
    if (event.type === "turn-completed") setBusy(false);
  });
  onCleanup(() => {
    disposed = true;
    unsubscribe();
    setSendShortcutMode(previousShortcut);
  });
  onSettled(() => {
    setSendShortcutMode("enter");
    selectAgent(MARKETING_DEMO_MANIFEST.agents[0]?.id ?? "campaign");
  });
  async function run(action: PreviewUseCaseAction): Promise<void> {
    if (busy() || disposed) return;
    setBusy(true);
    setError(null);
    layout.setSidebarView("agents");
    selectAgent(action.agentId);
    try {
      await props.mock.api.agent.sendMessage({ agentId: action.agentId, text: action.prompt, attachmentDraftIds: [] });
    } catch {
      if (!disposed) {
        setBusy(false);
        setError(t("preview.demo.failed"));
      }
    }
  }
  return (
    <header class="marketing-demo-guide">
      <div class="marketing-demo-heading">
        <div>
          <strong>{t("preview.demo.title")}</strong>
          <p>{t("preview.demo.description")}</p>
        </div>
        <div class="marketing-demo-navigation">
          <Button variant="outline" size="sm" onClick={props.onReset}>
            {t("preview.demo.reset")}
          </Button>
          <Button as="a" href="/app" size="sm" class="marketing-demo-start">
            {t("preview.demo.start")}
          </Button>
          <Show when={props.onExit}>
            <Button variant="ghost" size="sm" onClick={() => props.onExit?.()}>
              {t("preview.demo.exit")}
            </Button>
          </Show>
        </div>
      </div>
      <fieldset class="marketing-demo-actions" aria-label={t("preview.demo.guide")}>
        <For each={MARKETING_DEMO_MANIFEST.actions}>
          {(action) => (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy()}
              onClick={() => {
                void run(action);
              }}
            >
              {t(action.labelKey)}
            </Button>
          )}
        </For>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            selectAgent("content");
            layout.setSidebarView("routines");
          }}
        >
          {t("preview.demo.routines")}
        </Button>
      </fieldset>
      <p class="marketing-demo-status" role="status">
        {error() ?? (busy() ? t("preview.demo.running") : t("preview.demo.simulatedResult"))}
      </p>
      <span class="marketing-demo-selected">
        {t("preview.demo.selected", {
          name: MARKETING_DEMO_MANIFEST.agents.find((agent) => agent.id === activeAgentId())?.name ?? "",
        })}
      </span>
    </header>
  );
}
