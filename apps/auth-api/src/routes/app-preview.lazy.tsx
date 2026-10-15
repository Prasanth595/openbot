import { Button } from "@openbot/ui/button";
import { useText } from "@openbot/ui/text";
import { createLazyFileRoute } from "@tanstack/solid-router";
import { createSignal, lazy, onSettled, Show } from "solid-js";
import "../../../../src/renderer/src/preview/preview.css";

const OpenBotPlayground = lazy(() =>
  import("@openbot/renderer-preview").then((module) => ({ default: module.OpenBotPlayground })),
);
const MarketingDemo = lazy(() =>
  import("@openbot/renderer-marketing-demo").then((module) => ({ default: module.MarketingDemo })),
);
export const Route = createLazyFileRoute("/app-preview")({ component: AppPreviewPage });

export function AppPreviewPage() {
  const { t } = useText();
  const [mounted, setMounted] = createSignal(false);
  const [demo, setDemo] = createSignal(false);
  const [demoOpen, setDemoOpen] = createSignal(true);
  onSettled(() => {
    // Only this fixed identifier selects a use case. No visitor input becomes configuration.
    setDemo(new URL(window.location.href).searchParams.get("useCase") === "marketing");
    setMounted(true);
  });
  return (
    <div id="root" class="openbot-playground-root" data-preview-variant={demo() ? "marketing" : "landing"}>
      <Show
        when={mounted()}
        fallback={<div class="openbot-playground-loading" role="status" aria-label={t("app.loading")} />}
      >
        <Show when={demo()} fallback={<OpenBotPlayground variant="landing" />}>
          <Show
            when={demoOpen()}
            fallback={
              <div class="marketing-demo-ended">
                <p>{t("preview.demo.ended")}</p>
                <Button onClick={() => setDemoOpen(true)}>{t("preview.demo.reopen")}</Button>
                <Button as="a" href="/app" variant="outline">
                  {t("preview.demo.start")}
                </Button>
              </div>
            }
          >
            <MarketingDemo onExit={() => setDemoOpen(false)} />
          </Show>
        </Show>
      </Show>
    </div>
  );
}
