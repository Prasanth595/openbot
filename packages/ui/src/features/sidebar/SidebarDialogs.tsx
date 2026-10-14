/** The sidebar's agent, channel and section confirmations share one pending delete state. */

import { ConfirmDialog } from "@openbot/ui";
import { createEffect, createSignal, Show } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ChannelAvatar } from "../channels/ChannelAvatar";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarDialogs() {
  const {
    getAgentListElement,
    closeDelete,
    confirmDelete,
    confirmSectionDelete,
    deleteError,
    deleteTarget,
    channelDeleteTarget,
    deleting,
    props,
    permanentDeleteTarget,
    sectionDeleteTarget,
  } = useSidebarScope();
  const { t } = useText();
  const [agentDialog, setAgentDialog] = createSignal<ReturnType<typeof deleteTarget>>();
  createEffect(deleteTarget, (agent) => {
    if (agent) setAgentDialog(agent);
  });
  const shared = {
    get confirmLabel() {
      return t("common.delete");
    },
    get pendingLabel() {
      return t("sidebar.delete.pending");
    },
    onCancel: closeDelete,
  };
  // Each dialog unmounts with its target, so its text never shows an empty name while it closes.
  return (
    <>
      <Show when={permanentDeleteTarget()}>
        {(target) => (
          <ConfirmDialog
            {...shared}
            open
            initialFocus="cancel"
            restoreFocusTarget={getAgentListElement()}
            pending={deleting()}
            error={deleteError()}
            title={t("sidebar.delete.permanentTitle", { name: target().name })}
            description={t("sidebar.delete.permanentDescription")}
            confirmLabel={t("sidebar.delete.permanently")}
            onConfirm={confirmDelete}
          />
        )}
      </Show>
      <Show when={agentDialog()}>
        {(agent) => (
          <ConfirmDialog
            {...shared}
            open={Boolean(deleteTarget())}
            restoreFocusTarget={getAgentListElement()}
            pending={deleting()}
            error={deleteError()}
            media={<AgentAvatar agent={agent()} style={{ width: "44px", height: "44px" }} />}
            title={t("sidebar.delete.title", { name: agent().name })}
            description={
              props.onRestoreLastDeletedAgent
                ? t("sidebar.delete.retainedAgentDescription")
                : t("sidebar.delete.agentDescription")
            }
            onConfirm={confirmDelete}
          />
        )}
      </Show>

      <Show when={channelDeleteTarget()}>
        {(channel) => (
          <ConfirmDialog
            {...shared}
            open
            pending={deleting()}
            error={deleteError()}
            media={<ChannelAvatar members={channel().members} agents={props.agents} layout="cluster" />}
            title={t("sidebar.delete.title", { name: channel().name })}
            description={t("sidebar.delete.channelDescription")}
            onConfirm={confirmDelete}
          />
        )}
      </Show>

      <Show when={sectionDeleteTarget()}>
        {(section) => (
          <ConfirmDialog
            {...shared}
            open
            pending={deleting()}
            error={deleteError()}
            title={t("sidebar.delete.title", { name: section().name })}
            description={t("sidebar.delete.sectionDescription")}
            onConfirm={confirmSectionDelete}
          />
        )}
      </Show>
    </>
  );
}
