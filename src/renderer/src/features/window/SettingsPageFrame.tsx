import type { ServerSummary } from "@openbot/contracts/ipc";
import { ServerMark } from "@openbot/ui/features/servers/ServerRail";
import type { SettingsPagePlacement } from "@openbot/ui/features/settings/SettingsDialogShell";
import type { JSX } from "@solidjs/web";
import { onSettled } from "solid-js";

/**
 * The frame of a settings page, on desktop and on the web: the heading and the section list at the
 * width of the sidebar, and the panel. The settings panel shows its nav and content in the mounts
 * that `onMounts` gets.
 */
export function SettingsPageFrame(props: {
  heading: JSX.Element;
  /** Content between the heading and the section list, such as a search. */
  children?: JSX.Element;
  sectionsHidden?: boolean;
  onMounts: (mounts: SettingsPagePlacement | undefined) => void;
  /** Escape outside a popup or a text field of the window. */
  onEscape: () => void;
}) {
  let nav!: HTMLDivElement;
  let content!: HTMLDivElement;
  let root!: HTMLDivElement;

  onSettled(() => {
    props.onMounts({ nav, content });
    // Escape closes the page, as it closed the settings dialog. On the document and after the
    // delegated handlers, so a control that handles Escape keeps it. The focus can stay on the rail
    // button or the server menu that opened the page, so a target outside the page also counts,
    // except an open popup or a text field.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]")) return;
      if (target && !root.contains(target) && target.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      props.onEscape();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      props.onMounts(undefined);
    };
  });

  return (
    <div class="settings-page" ref={root}>
      <div class="settings-page-nav">
        {props.heading}
        {props.children}
        <div class="settings-page-sections" ref={nav} hidden={props.sectionsHidden} />
      </div>
      <div class="settings-page-content" ref={content} />
    </div>
  );
}

/** The heading of a server settings page: the server mark and name, as the server menu shows them. */
export function ServerSettingsPageTitle(props: { server: ServerSummary }) {
  return (
    <h1 class="settings-page-title settings-page-server">
      <span class="server-menu-mark" aria-hidden="true">
        <ServerMark server={props.server} />
      </span>
      <span class="server-menu-name">{props.server.name}</span>
    </h1>
  );
}
