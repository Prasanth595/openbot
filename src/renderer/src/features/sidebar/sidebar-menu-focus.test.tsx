import { Dialog, DropdownMenu } from "@openbot/ui";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import type { SidebarProps } from "@openbot/ui/features/sidebar/sidebar-types";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { toAgentProfile } from "../../app-message-projection";
import { AppProviders } from "../../app-providers";
import { AGENTS, emitServers, installOpenbotStub, testServer, trackAnalytics } from "../../app-test-harness";
import { useAgentActions } from "../agents/agent-actions";
import { useServers } from "../servers/servers-context";

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Test scope is not ready");
  return value;
}

function renderSidebar(overrides: Partial<SidebarProps> = {}, extra?: () => JSX.Element) {
  const onMutateLayout = vi.fn(async () => {});
  const noop = () => {};
  const view = render(() => (
    <>
      <button type="button">Previous focus</button>
      <textarea aria-label="Conversation draft" />
      <Sidebar
        serverName="Test server"
        activeAgentId=""
        people={[]}
        directThreads={[]}
        activeDirectMemberId={null}
        agentStates={{}}
        agentMoods={{}}
        layout={{ revision: 1, sections: [], order: ["people", "unassigned"], agentAssignments: {}, agentOrder: [] }}
        collapsedSectionIds={[]}
        onMutateLayout={onMutateLayout}
        onToggleSection={noop}
        pinnedItems={[]}
        peopleOrder={[]}
        onPin={noop}
        onUnpin={noop}
        onReorderPinned={noop}
        onReorderPeople={noop}
        onSelectAgent={noop}
        onSelectPerson={noop}
        onCreateAgent={noop}
        onEditAgent={noop}
        onDeleteAgent={async () => {}}
        compact={false}
        onExpand={noop}
        onOpenMarketplace={noop}
        onOpenSearch={noop}
        {...overrides}
        agents={overrides.agents ?? []}
      />
      {extra?.()}
    </>
  ));
  return { onMutateLayout, unmount: view.unmount };
}

// Timers and frames are independent scheduler inputs, not elapsed-time barriers.
function controlCloseSchedule() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  return {
    async frame() {
      for (const [id, callback] of Array.from(frames)) {
        frames.delete(id);
        callback(performance.now());
        await Promise.resolve();
      }
    },
    async close() {
      await vi.advanceTimersByTimeAsync(1);
      await vi.runOnlyPendingTimersAsync();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([
  ["timer first", "pointer"],
  ["frames first", "pointer"],
  ["timer first", "keyboard"],
  ["frames first", "keyboard"],
])("keeps the real plus editor usable when %s with %s selection", async (order, method) => {
  const { onMutateLayout } = renderSidebar();
  const schedule = controlCloseSchedule();
  const trigger = screen.getByRole("button", { name: "New agent or section" });
  trigger.focus();
  const draft = screen.getByRole("textbox", { name: "Conversation draft" });
  await fireEvent.input(draft, { target: { value: "Keep the unsent body" } });
  if (method === "keyboard") await fireEvent.keyDown(trigger, { key: "Enter" });
  else await fireEvent.pointerDown(trigger, { button: 0 });
  const item = await screen.findByRole("menuitem", { name: "New section" });
  if (method === "keyboard") {
    await finishClose(schedule);
    await fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(item).toHaveFocus();
    await fireEvent.keyDown(item, { key: "Enter" });
  } else await fireEvent.pointerUp(item, { button: 0 });
  if (order === "timer first") await schedule.close();
  await schedule.frame();
  await schedule.frame();
  await schedule.frame();
  if (order === "frames first") await schedule.close();
  await schedule.frame();
  await schedule.frame();
  const editor = screen.getByRole("textbox", { name: "New section name" });
  expect(editor).toHaveFocus();
  await fireEvent.input(editor, { target: { value: "Research" } });
  await fireEvent.keyDown(editor, { key: "Enter" });
  expect(onMutateLayout).toHaveBeenCalledExactlyOnceWith({ type: "create", name: "Research" });
  expect(draft).toHaveValue("Keep the unsent body");
});

async function finishClose(schedule: ReturnType<typeof controlCloseSchedule>) {
  await schedule.close();
  await schedule.frame();
  await schedule.frame();
}

it.each([true, false])("hands the actual free-area menu to an editor with previous focus=%s", async (connected) => {
  renderSidebar();
  const previous = screen.getByRole("button", { name: "Previous focus" });
  if (connected) previous.focus();
  else previous.remove();
  await fireEvent.contextMenu(screen.getByLabelText("Sidebar free area"));
  const item = await screen.findByRole("menuitem", { name: "New section" });
  const schedule = controlCloseSchedule();
  await fireEvent.pointerUp(item, { button: 0 });
  await finishClose(schedule);
  expect(screen.getByRole("textbox", { name: "New section name" })).toHaveFocus();
});

it("hands a real Move to submenu to the editor and preserves the selected chat assignment", async () => {
  const { onMutateLayout } = renderSidebar({
    channels: [
      {
        id: "room",
        name: "Project room",
        title: "",
        instructions: "",
        members: [],
        leadAgentId: null,
        archived: false,
        revision: 1,
        createdAt: "2026-10-01T00:00:00Z",
        unreadCount: 0,
        activeTasks: 0,
        lastMessage: null,
      },
    ],
  });
  const row = screen.getByRole("button", { name: /^Project room\./ });
  row.focus();
  await fireEvent.contextMenu(row);
  const move = await screen.findByRole("menuitem", { name: "Move to" });
  await fireEvent.keyDown(move, { key: "ArrowRight" });
  const item = within(await screen.findByRole("menu", { name: "Move to" })).getByRole("menuitem", {
    name: "New section",
  });
  const schedule = controlCloseSchedule();
  await fireEvent.keyDown(item, { key: "Enter" });
  await finishClose(schedule);
  const editor = screen.getByRole("textbox", { name: "New section name" });
  expect(editor).toHaveFocus();
  await fireEvent.input(editor, { target: { value: "Research" } });
  await fireEvent.keyDown(editor, { key: "Enter" });
  expect(onMutateLayout).toHaveBeenCalledExactlyOnceWith({ type: "create", name: "Research", agentId: "room" });
  expect(screen.getByRole("button", { name: /^Project room\./ })).toBeInTheDocument();
});

it("renames through the actual header menu after its trigger disconnects", async () => {
  const { onMutateLayout } = renderSidebar({
    layout: {
      revision: 1,
      sections: [{ id: "research", name: "Research" }],
      order: ["people", "unassigned", "research"],
      agentAssignments: {},
      agentOrder: [],
    },
  });
  const trigger = screen.getByRole("button", { name: "Research" });
  trigger.focus();
  await fireEvent.contextMenu(trigger);
  const item = await screen.findByRole("menuitem", { name: "Rename" });
  const schedule = controlCloseSchedule();
  await fireEvent.pointerUp(item, { button: 0 });
  await finishClose(schedule);
  const editor = screen.getByRole("textbox", { name: "Rename section" });
  expect(trigger.isConnected).toBe(false);
  expect(editor).toHaveFocus();
  expect(editor).toHaveValue("Research");
  await fireEvent.input(editor, { target: { value: "Planning" } });
  await fireEvent.keyDown(editor, { key: "Enter" });
  expect(onMutateLayout).toHaveBeenCalledExactlyOnceWith({ type: "rename", sectionId: "research", name: "Planning" });
});

async function openEditor() {
  const trigger = screen.getByRole("button", { name: "New agent or section" });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: "Enter" });
  const item = await screen.findByRole("menuitem", { name: "New section" });
  const schedule = controlCloseSchedule();
  await fireEvent.keyDown(item, { key: "Enter" });
  await finishClose(schedule);
  return { editor: screen.getByRole("textbox", { name: "New section name" }), schedule, trigger };
}

it.each(["Escape", "outside"])("keeps editor cancellation on %s", async (dismiss) => {
  const { onMutateLayout } = renderSidebar();
  const { editor } = await openEditor();
  await fireEvent.input(editor, { target: { value: "Unfinished" } });
  if (dismiss === "Escape") await fireEvent.keyDown(editor, { key: "Escape" });
  else {
    screen.getByRole("button", { name: "Previous focus" }).focus();
    await Promise.resolve();
  }
  expect(screen.queryByRole("textbox", { name: "New section name" })).not.toBeInTheDocument();
  expect(onMutateLayout).not.toHaveBeenCalled();
});

it("keeps a saving editor on blur and submits Enter only once", async () => {
  let complete: (() => void) | undefined;
  const onMutateLayout = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  renderSidebar({ onMutateLayout });
  const { editor } = await openEditor();
  await fireEvent.input(editor, { target: { value: "Research" } });
  await fireEvent.keyDown(editor, { key: "Enter" });
  await fireEvent.keyDown(editor, { key: "Enter" });
  await fireEvent.blur(editor);
  expect(editor).toBeInTheDocument();
  expect(editor).toBeDisabled();
  expect(onMutateLayout).toHaveBeenCalledTimes(1);
  complete?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(screen.queryByRole("textbox", { name: "New section name" })).not.toBeInTheDocument();
});

it("keeps validation and failed saves editable for another attempt", async () => {
  const onMutateLayout = vi.fn().mockRejectedValueOnce(new Error("Try again")).mockResolvedValueOnce(undefined);
  renderSidebar({ onMutateLayout });
  const { editor } = await openEditor();
  await fireEvent.keyDown(editor, { key: "Enter" });
  expect(screen.getByRole("alert")).toHaveTextContent("Section name is required.");
  expect(editor).toHaveFocus();
  await fireEvent.input(editor, { target: { value: "Research" } });
  await fireEvent.keyDown(editor, { key: "Enter" });
  await Promise.resolve();
  expect(editor).toHaveFocus();
  expect(editor).not.toBeDisabled();
  expect(editor).toHaveValue("Research");
  await fireEvent.input(editor, { target: { value: "Planning" } });
  await fireEvent.keyDown(editor, { key: "Enter" });
  expect(onMutateLayout.mock.calls).toEqual([
    [{ type: "create", name: "Research" }],
    [{ type: "create", name: "Planning" }],
  ]);
});

it.each(["Escape", "outside"])("restores the plus trigger on ordinary %s dismissal", async (dismiss) => {
  renderSidebar();
  const schedule = controlCloseSchedule();
  const trigger = screen.getByRole("button", { name: "New agent or section" });
  trigger.focus();
  await fireEvent.pointerDown(trigger, { button: 0 });
  const menu = await screen.findByRole("menu");
  const outside = screen.getByText("Previous focus");
  await finishClose(schedule);
  if (dismiss === "Escape") await fireEvent.keyDown(menu, { key: "Escape" });
  else await fireEvent.pointerDown(outside, { button: 0 });
  await finishClose(schedule);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("textbox", { name: "New section name" })).not.toBeInTheDocument();
});

it("does not let old restore callbacks steal a rapidly reopened menu or its next editor", async () => {
  renderSidebar();
  const trigger = screen.getByRole("button", { name: "New agent or section" });
  trigger.focus();
  await fireEvent.pointerDown(trigger, { button: 0 });
  const menu = await screen.findByRole("menu");
  const schedule = controlCloseSchedule();
  await fireEvent.keyDown(menu, { key: "Escape" });
  await fireEvent.pointerDown(trigger, { button: 0 });
  const item = screen.getByRole("menuitem", { name: "New section" });
  item.focus();
  await schedule.frame();
  await schedule.frame();
  expect(menu).toHaveFocus();
  expect(trigger).not.toHaveFocus();
  item.focus();
  await fireEvent.keyDown(item, { key: "Enter" });
  await finishClose(schedule);
  expect(screen.getByRole("textbox", { name: "New section name" })).toHaveFocus();
});

it("hands the real New channel menu action to a Dialog without an expired menu restore", async () => {
  const [open, setOpen] = createSignal(false);
  renderSidebar({ onCreateChannel: () => setOpen(true) }, () => (
    <Dialog.Root open={open()} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Content>
          <Dialog.Title>New channel</Dialog.Title>
          <input aria-label="Channel name" />
          <Dialog.CloseButton>Cancel</Dialog.CloseButton>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  ));
  const trigger = screen.getByRole("button", { name: "New agent or section" });
  trigger.focus();
  await fireEvent.pointerDown(trigger, { button: 0 });
  const item = await screen.findByRole("menuitem", { name: "New channel" });
  const schedule = controlCloseSchedule();
  await fireEvent.pointerUp(item, { button: 0 });
  await finishClose(schedule);
  const dialog = screen.getByRole("dialog", { name: "New channel" });
  expect(within(dialog).getByRole("textbox", { name: "Channel name" })).toHaveFocus();
  await schedule.frame();
  await schedule.frame();
  expect(within(dialog).getByRole("textbox", { name: "Channel name" })).toHaveFocus();
  await fireEvent.keyDown(dialog, { key: "Escape" });
  await finishClose(schedule);
  expect(screen.queryByRole("dialog", { name: "New channel" })).not.toBeInTheDocument();
});

it("keeps ordinary Item selection immediate and a non-closing Item open", async () => {
  const select = vi.fn();
  render(() => (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>Actions</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item closeOnSelect={false} onSelect={select}>
            Keep open
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  ));
  await fireEvent.pointerDown(screen.getByRole("button", { name: "Actions" }), { button: 0 });
  const item = await screen.findByRole("menuitem", { name: "Keep open" });
  const schedule = controlCloseSchedule();
  await fireEvent.pointerUp(item, { button: 0 });
  expect(select).toHaveBeenCalledTimes(1);
  await finishClose(schedule);
  expect(item).toBeInTheDocument();
});

it("drops a selected handoff when the menu owner unmounts", async () => {
  const onCreateChannel = vi.fn();
  const { unmount } = renderSidebar({ onCreateChannel });
  await fireEvent.pointerDown(screen.getByRole("button", { name: "New agent or section" }), { button: 0 });
  const item = await screen.findByRole("menuitem", { name: "New channel" });
  const schedule = controlCloseSchedule();
  await fireEvent.pointerUp(item, { button: 0 });
  unmount();
  await finishClose(schedule);
  expect(onCreateChannel).not.toHaveBeenCalled();
});

it("discards an old selection when a controlled menu reopens before its exit", async () => {
  const [open, setOpen] = createSignal(false);
  const action = vi.fn();
  render(() => (
    <DropdownMenu.Root open={open()} onOpenChange={setOpen}>
      <DropdownMenu.Trigger>Actions</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item onSelectAfterClose={action}>Open editor</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  ));
  const trigger = screen.getByRole("button", { name: "Actions" });
  trigger.focus();
  await fireEvent.pointerDown(trigger, { button: 0 });
  const item = await screen.findByRole("menuitem", { name: "Open editor" });
  const schedule = controlCloseSchedule();
  await fireEvent.pointerUp(item, { button: 0 });
  await vi.advanceTimersByTimeAsync(1);
  setOpen(true);
  await Promise.resolve();
  await finishClose(schedule);
  expect(action).not.toHaveBeenCalled();
  expect(screen.getByRole("menuitem", { name: "Open editor" })).toBeInTheDocument();
  await fireEvent.keyDown(item, { key: "Enter" });
  await finishClose(schedule);
  expect(action).toHaveBeenCalledTimes(1);
});

it("retains initial focus and ordinary dismissal for a default-open menu", async () => {
  const schedule = controlCloseSchedule();
  render(() => (
    <DropdownMenu.Root defaultOpen>
      <DropdownMenu.Trigger>Actions</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item>Read</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  ));
  await finishClose(schedule);
  const menu = screen.getByRole("menu");
  expect(menu).toHaveFocus();
  const trigger = screen.getByRole("button", { name: "Actions", hidden: true });
  await fireEvent.keyDown(menu, { key: "Escape" });
  await finishClose(schedule);
  expect(trigger).toHaveFocus();
});

it("waits for an actual controlled close rather than a rejected close request", async () => {
  const action = vi.fn();
  const onOpenChange = vi.fn();
  const schedule = controlCloseSchedule();
  render(() => (
    <DropdownMenu.Root open onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger>Actions</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item onSelectAfterClose={action}>Open editor</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  ));
  await finishClose(schedule);
  const item = screen.getByRole("menuitem", { name: "Open editor" });
  item.focus();
  await fireEvent.keyDown(item, { key: "Enter" });
  await finishClose(schedule);
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(action).not.toHaveBeenCalled();
  expect(item).toHaveFocus();
});

it.each([{ ctrlKey: true }, { metaKey: true }])(
  "restores from focused sidebar navigation with %j",
  async (modifier) => {
    const restore = vi.fn(async () => {});
    renderSidebar({ onRestoreLastDeletedAgent: restore, canRestoreLastDeletedAgent: true });
    const navigation = screen.getByRole("navigation", { name: "Chat list" });
    navigation.focus();
    expect(navigation).toHaveFocus();
    await fireEvent.keyDown(navigation, { key: "z", ...modifier });
    expect(restore).toHaveBeenCalledOnce();
  },
);

it("offers restore in the empty agents area and invokes the action", async () => {
  const restore = vi.fn(async () => {});
  renderSidebar({ onRestoreLastDeletedAgent: restore, canRestoreLastDeletedAgent: true });
  await fireEvent.contextMenu(screen.getByLabelText("Sidebar free area"));
  const item = await screen.findByRole("menuitem", { name: "Restore last deleted agent" });
  await fireEvent.pointerUp(item, { button: 0 });
  expect(restore).toHaveBeenCalledOnce();
});

it("preserves editor undo and does not restore through an open dialog", async () => {
  const restore = vi.fn(async () => {});
  renderSidebar({ onRestoreLastDeletedAgent: restore, canRestoreLastDeletedAgent: true });
  const navigation = screen.getByRole("navigation", { name: "Chat list" });
  for (const editor of [
    document.createElement("input"),
    document.createElement("textarea"),
    document.createElement("div"),
  ]) {
    if (editor.tagName === "DIV") editor.setAttribute("contenteditable", "true");
    navigation.append(editor);
    const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    editor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    editor.remove();
  }
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  try {
    await fireEvent.keyDown(navigation, { key: "z", ctrlKey: true });
    expect(restore).not.toHaveBeenCalled();
  } finally {
    dialog.remove();
  }
});

it("does not consume redo or a shortcut with no available undo", async () => {
  const restore = vi.fn(async () => {});
  renderSidebar({ onRestoreLastDeletedAgent: restore, canRestoreLastDeletedAgent: false });
  const navigation = screen.getByRole("navigation", { name: "Chat list" });
  const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
  navigation.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(restore).not.toHaveBeenCalled();
  await fireEvent.contextMenu(screen.getByLabelText("Sidebar free area"));
  expect(await screen.findByRole("menuitem", { name: "Restore last deleted agent" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

it.each(["undo", "user focus", "disposed scope"])("closes actual agent deletion safely with %s", async (mode) => {
  const [agents, setAgents] = createSignal([toAgentProfile(AGENTS[0])]);
  const done = Promise.withResolvers<void>();
  const restore = vi.fn(async () => {
    setAgents([toAgentProfile(AGENTS[0])]);
  });
  const view = renderSidebar({
    get agents() {
      return agents();
    },
    onDeleteAgent: async () => {
      await done.promise;
      setAgents([]);
    },
    onRestoreLastDeletedAgent: restore,
    canRestoreLastDeletedAgent: true,
  });
  const row = screen.getByRole("button", { name: new RegExp(`^${AGENTS[0].name}`) });
  row.focus();
  await fireEvent.contextMenu(row);
  const menuDelete = await screen.findByRole("menuitem", { name: "Delete agent" });
  const schedule = controlCloseSchedule();
  await fireEvent.pointerUp(menuDelete, { button: 0 });
  await finishClose(schedule);
  const dialog = screen.getByRole("alertdialog");
  const confirm = within(dialog).getByRole("button", { name: "Delete" });
  expect(confirm).toHaveFocus();
  await fireEvent.click(confirm);
  if (mode === "disposed scope") {
    view.unmount();
    const other = document.createElement("input");
    document.body.append(other);
    other.focus();
    done.resolve();
    await finishClose(schedule);
    expect(other).toHaveFocus();
    other.remove();
    return;
  }
  done.resolve();
  // Completion enables the button before the controlled dialog runs its close scheduler.
  await waitFor(() => expect(confirm).toBeEnabled());
  await schedule.close();
  if (mode === "user focus") {
    const draft = screen.getByRole("textbox", { name: "Conversation draft" });
    draft.focus();
    await schedule.frame();
    await schedule.frame();
    expect(draft).toHaveFocus();
    expect(restore).not.toHaveBeenCalled();
    return;
  }
  await finishClose(schedule);
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  const navigation = screen.getByRole("navigation", { name: "Chat list" });
  expect(navigation).toHaveFocus();
  await fireEvent.keyDown(navigation, { key: "z", ctrlKey: true });
  expect(restore).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: new RegExp(`^${AGENTS[0].name}`) })).toBeInTheDocument();
});

// Failure modes: Cancel deletes data, confirmation drifts to a new target, or repeat submission deletes twice.
it.each(["cancel", "success", "error"])("confirms captured permanent deletion with %s", async (mode) => {
  const result = Promise.withResolvers<void>();
  const remove = vi.fn(() => result.promise);
  const [candidate, setCandidate] = createSignal<SidebarProps["permanentDeleteTarget"]>({
    id: "latest",
    name: "Latest removed",
    onConfirm: remove,
  });
  const restore = vi.fn(async () => {});
  renderSidebar({
    get permanentDeleteTarget() {
      return candidate();
    },
    onRestoreLastDeletedAgent: restore,
    canRestoreLastDeletedAgent: true,
  });
  await fireEvent.contextMenu(screen.getByLabelText("Sidebar free area"));
  const menu = await screen.findByRole("menu");
  expect(menu).toHaveAccessibleDescription("Removed data stays on this computer.");
  expect(screen.queryByRole("menuitem", { name: "Removed data stays on this computer." })).not.toBeInTheDocument();
  const schedule = controlCloseSchedule();
  await fireEvent.pointerUp(screen.getByRole("menuitem", { name: "Delete permanently" }), { button: 0 });
  await finishClose(schedule);
  const dialog = screen.getByRole("alertdialog", { name: "Delete “Latest removed” permanently?" });
  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  expect(cancel).toHaveFocus();
  setCandidate({ id: "older", name: "Older removed", onConfirm: vi.fn(async () => {}) });
  expect(dialog).toHaveAccessibleName("Delete “Latest removed” permanently?");
  if (mode === "cancel") {
    await fireEvent.click(cancel);
    await finishClose(schedule);
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    return;
  }
  const confirm = within(dialog).getByRole("button", { name: "Delete permanently" });
  await fireEvent.click(confirm);
  await fireEvent.click(confirm);
  expect(remove).toHaveBeenCalledOnce();
  if (mode === "error") {
    result.reject(new Error("Cannot delete local data"));
    // The promise rejection is the event. Use the rendered error as the completion barrier.
    await Promise.resolve();
    expect(await within(dialog).findByText("Cannot delete local data")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete permanently" })).toBeEnabled();
  } else {
    result.resolve();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await finishClose(schedule);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await fireEvent.contextMenu(screen.getByLabelText("Sidebar free area"));
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Delete permanently" }), { button: 0 });
    await finishClose(schedule);
    expect(screen.getByRole("alertdialog", { name: "Delete “Older removed” permanently?" })).toBeInTheDocument();
  }
  expect(restore).not.toHaveBeenCalled();
});

it("uses the existing delete operation and refreshes the next retained candidate after successful uninstall", async () => {
  installOpenbotStub();
  const candidate = {
    ...AGENTS[0],
    marketplaceSource: {
      listingId: "listing",
      versionId: "version",
      version: 1,
      skillIds: [],
      routineIds: [],
    },
  };
  vi.mocked(window.openbot.agent.lastDeletedAgent).mockResolvedValue(candidate);
  let actions: ReturnType<typeof useAgentActions> | undefined;
  function Probe() {
    actions = useAgentActions();
    return null;
  }
  render(() => (
    <AppProviders>
      <Probe />
    </AppProviders>
  ));
  await vi.waitFor(() => expect(actions?.permanentDeleteTarget()?.id).toBe(candidate.id));
  const target = requireValue(requireValue(actions).permanentDeleteTarget());
  const deleted = Promise.withResolvers<void>();
  vi.mocked(window.openbot.agent.deleteAgent).mockReturnValue(deleted.promise);
  const first = target.onConfirm();
  expect(trackAnalytics).not.toHaveBeenCalledWith(
    "marketplace_action",
    expect.objectContaining({ action: "uninstall", result: "succeeded" }),
  );
  await target.onConfirm();
  expect(window.openbot.agent.deleteAgent).toHaveBeenCalledExactlyOnceWith(candidate.id, "local");
  vi.mocked(window.openbot.agent.lastDeletedAgent).mockResolvedValue(AGENTS[1]);
  deleted.resolve();
  await first;
  expect(requireValue(actions).permanentDeleteTarget()?.id).toBe(AGENTS[1].id);
  expect(requireValue(actions).canRestoreLastDeletedAgent()).toBe(true);
  expect(trackAnalytics).toHaveBeenCalledWith("marketplace_action", {
    entity: "agent",
    action: "uninstall",
    result: "succeeded",
  });
  expect(window.openbot.agent.removeAgentForRecovery).not.toHaveBeenCalled();
});

it.each(["before submit", "pending reply"])(
  "keeps permanent deletion in its captured server scope (%s)",
  async (mode) => {
    installOpenbotStub();
    vi.mocked(window.openbot.agent.lastDeletedAgent).mockResolvedValue(AGENTS[0]);
    let actions: ReturnType<typeof useAgentActions> | undefined;
    let servers: ReturnType<typeof useServers> | undefined;
    function Probe() {
      actions = useAgentActions();
      servers = useServers();
      return null;
    }
    render(() => (
      <AppProviders>
        <Probe />
      </AppProviders>
    ));
    await vi.waitFor(() => expect(actions?.permanentDeleteTarget()?.id).toBe(AGENTS[0].id));
    const oldTarget = requireValue(requireValue(actions).permanentDeleteTarget());
    const deleted = Promise.withResolvers<void>();
    vi.mocked(window.openbot.agent.deleteAgent).mockReturnValue(deleted.promise);
    const pending = mode === "pending reply" ? oldTarget.onConfirm() : undefined;
    emitServers?.([testServer("local", false), testServer("studio", true)]);
    await vi.waitFor(() => expect(servers?.activeServerId()).toBe("studio"));
    expect(requireValue(actions).permanentDeleteTarget()).toBeUndefined();
    if (pending) {
      const queryCount = vi.mocked(window.openbot.agent.lastDeletedAgent).mock.calls.length;
      deleted.resolve();
      await pending;
      expect(window.openbot.agent.lastDeletedAgent).toHaveBeenCalledTimes(queryCount);
      expect(window.openbot.agent.deleteAgent).toHaveBeenCalledExactlyOnceWith(AGENTS[0].id, "local");
    } else {
      await expect(oldTarget.onConfirm()).rejects.toThrow();
      expect(window.openbot.agent.deleteAgent).not.toHaveBeenCalled();
    }
    expect(requireValue(actions).canRestoreLastDeletedAgent()).toBe(false);
  },
);

it("does not report retention or a failed permanent delete as a successful marketplace uninstall", async () => {
  installOpenbotStub();
  const candidate = {
    ...AGENTS[0],
    marketplaceSource: {
      listingId: "listing",
      versionId: "version",
      version: 1,
      skillIds: [],
      routineIds: [],
    },
  };
  vi.mocked(window.openbot.agent.listAgents).mockResolvedValue([candidate]);
  vi.mocked(window.openbot.agent.lastDeletedAgent).mockResolvedValue(candidate);
  let actions: ReturnType<typeof useAgentActions> | undefined;
  function Probe() {
    actions = useAgentActions();
    return null;
  }
  render(() => (
    <AppProviders>
      <Probe />
    </AppProviders>
  ));
  await vi.waitFor(() => expect(actions?.permanentDeleteTarget()?.id).toBe(candidate.id));
  await requireValue(actions).deleteAgent(candidate.id);
  await vi.waitFor(() => expect(actions?.permanentDeleteTarget()?.id).toBe(candidate.id));
  vi.mocked(window.openbot.agent.deleteAgent).mockRejectedValue(new Error("Deletion failed"));
  await expect(requireValue(requireValue(actions).permanentDeleteTarget()).onConfirm()).rejects.toThrow(
    "Deletion failed",
  );
  expect(requireValue(actions).permanentDeleteTarget()?.id).toBe(candidate.id);
  expect(requireValue(actions).canRestoreLastDeletedAgent()).toBe(true);
  expect(trackAnalytics).not.toHaveBeenCalledWith(
    "marketplace_action",
    expect.objectContaining({ action: "uninstall", result: "succeeded" }),
  );
});
