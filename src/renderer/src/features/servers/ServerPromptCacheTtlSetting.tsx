import {
  type OpenBotDesktopApi,
  PROMPT_CACHE_TTLS,
  type PromptCacheTtl,
  type PromptCacheTtlSetting,
} from "@openbot/contracts/ipc";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show, untrack } from "solid-js";

/** The prompt cache calls of one server's host. The desktop reaches them through main. */
export type HostPromptCacheTtlCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getPromptCacheTtl" | "setPromptCacheTtl">;

export interface ServerPromptCacheTtlOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostPromptCacheTtlCalls;
}

/**
 * Server Settings > General: how long Claude keeps the prompt cache of the agents of this computer
 * or a joined server (`prompt-cache-ttl-v1`). The host checks the role again.
 */
export function ServerPromptCacheTtlSetting(
  props: ServerPromptCacheTtlOptions & {
    serverId: string;
    disabled: boolean;
    menuMount: HTMLElement | undefined;
    run: (key: string, action: () => Promise<void>) => Promise<boolean>;
  },
) {
  const { t, errorMessage } = useText();
  const calls = (): HostPromptCacheTtlCalls => props.calls ?? window.openbot.hostAdmin;
  const [settings, setSettings] = createSignal<PromptCacheTtlSetting | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  /** Bumped for each server, so an answer for an earlier one is dropped. */
  let generation = 0;

  createEffect(
    () => props.serverId,
    (serverId) => {
      const current = ++generation;
      setSettings(null);
      setLoadError(null);
      untrack(calls)
        .getPromptCacheTtl(serverId)
        .then(
          (next) => {
            if (current === generation) setSettings(next);
          },
          (error: unknown) => {
            if (current === generation)
              setLoadError(errorMessage(error, t("server.settings.promptCacheTtlLoadFailed")));
          },
        );
    },
  );

  function choose(ttl: PromptCacheTtl | null): void {
    const current = settings();
    if (ttl === null || !current || ttl === current.ttl) return;
    const serverId = props.serverId;
    const request = generation;
    void props.run("promptCacheTtl", async () => {
      const next = await calls().setPromptCacheTtl(ttl, serverId);
      if (request === generation) setSettings(next);
    });
  }

  const label = (ttl: PromptCacheTtl) =>
    ttl === "1h" ? t("server.settings.promptCacheTtlHour") : t("server.settings.promptCacheTtlMinutes");

  return (
    <Item>
      <ItemContent>
        <ItemTitle id="server-settings-prompt-cache-ttl-label">{t("server.settings.promptCacheTtl")}</ItemTitle>
        <ItemDescription>{loadError() ?? t("server.settings.promptCacheTtlDescription")}</ItemDescription>
      </ItemContent>
      <Show when={settings()}>
        {(current) => (
          <ItemActions>
            <Select<PromptCacheTtl>
              options={[...PROMPT_CACHE_TTLS]}
              value={current().ttl}
              disabled={props.disabled}
              placement="bottom-end"
              onChange={choose}
              itemComponent={(item) => <SelectItem item={item.item}>{label(item.item.rawValue)}</SelectItem>}
            >
              <SelectTrigger size="sm" aria-labelledby="server-settings-prompt-cache-ttl-label">
                <SelectValue<PromptCacheTtl>>
                  {(state) => {
                    const selected = state.selectedOption();
                    return selected ? label(selected) : "";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent mount={props.menuMount} />
            </Select>
          </ItemActions>
        )}
      </Show>
    </Item>
  );
}
