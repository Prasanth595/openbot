import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
} from "@openbot/ui";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { useI18n } from "../../i18n-context";
import { AgentMemoriesModal } from "../conversation/AgentMemoriesModal";
import { userMemoriesPort } from "../conversation/memories-port";

interface SettingsMemoryTabProps {
  /** The tab is on screen. It reads the memories each time it shows. */
  visible: boolean;
}

/**
 * What every agent knows about the user. The memories open in the same dialog as an agent's own
 * memories, and stay on this computer.
 */
export function SettingsMemoryTab(props: SettingsMemoryTabProps) {
  const i18n = useI18n();
  const api = window.openbot.userMemories;
  const port = createMemo(() => userMemoriesPort(i18n.t("settings.memory.ownerLabel")));
  const [open, setOpen] = createSignal(false);
  const [count, setCount] = createSignal<number | null>(null);

  async function load(): Promise<void> {
    const memories = await api.list().catch(() => null);
    setCount(memories?.length ?? null);
  }

  createEffect(
    () => props.visible,
    (visible) => {
      if (!visible) return;
      void untrack(() => load());
      return window.openbot.agent.onEvent((event) => {
        if (event.type === "user-memories-changed") void load();
      });
    },
  );

  return (
    <>
      <SettingsSection title={i18n.t("settings.memory.about.section")}>
        <ItemGroup class="settings-modal-card">
          <Item data-settings-row="settings.memory.about.title">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.memory.about.title")}</ItemTitle>
              <ItemDescription>
                {i18n.t("settings.memory.about.description")}
                {count() === null ? "" : ` ${i18n.t("settings.memory.about.count", { count: count() ?? 0 })}`}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
                {i18n.t("settings.memory.about.manage")}
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>
      <AgentMemoriesModal port={port()} open={open()} onOpenChange={setOpen} onCountChange={setCount} />
    </>
  );
}
