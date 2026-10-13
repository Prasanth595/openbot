import { Popover } from "@openbot/ui";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";

// The popover gives focus back two frames after it closes.
async function afterFocusRestore() {
  for (let frame = 0; frame < 3; frame++) await new Promise((resolve) => requestAnimationFrame(resolve));
}

async function openContextPopover(focus: "trigger" | "composer") {
  render(() => (
    <>
      <textarea aria-label="Message Chief" />
      <Popover.Root>
        <Popover.Trigger>Context</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content>
            <Popover.Title>Context usage</Popover.Title>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  ));
  const trigger = screen.getByRole("button", { name: "Context" });
  const composer = screen.getByRole("textbox", { name: "Message Chief" });
  const listen = vi.spyOn(document, "addEventListener");
  // A mouse click on the trigger does not take focus from the composer.
  (focus === "trigger" ? trigger : composer).focus();
  await fireEvent.click(trigger);
  await screen.findByRole("dialog");
  // The popover starts to watch outside clicks one task after it opens.
  await waitFor(() => expect(listen).toHaveBeenCalledWith("pointerdown", expect.any(Function), true));
  listen.mockRestore();
  return { trigger, composer };
}

it("gives focus back to the trigger when Escape closes a popover", async () => {
  const { trigger } = await openContextPopover("trigger");

  await fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await afterFocusRestore();

  expect(trigger).toHaveFocus();
});

it("keeps focus in the composer when a click there closes a popover", async () => {
  const { composer } = await openContextPopover("composer");

  await fireEvent.pointerDown(composer, { button: 0 });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await afterFocusRestore();

  expect(composer).toHaveFocus();
});
