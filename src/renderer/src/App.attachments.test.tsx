import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { assert, beforeEach, expect, it } from "vitest";
import { App } from "./App";
import {
  attachment,
  confirmOnboardingModel,
  emitAttachmentImport,
  installOpenbotStub,
  subscriberCounts,
} from "./app-test-harness";

beforeEach(installOpenbotStub);

function importImage(requestId: string, id: string, name: string) {
  assert(emitAttachmentImport);
  emitAttachmentImport({ type: "started", requestId, serverId: "local" });
  emitAttachmentImport({
    type: "completed",
    requestId,
    serverId: "local",
    attachments: [attachment(id, name, "image")],
  });
}

it("keeps each pasted image once after agent chat switches and releases the import subscriber", async () => {
  const view = render(() => <App />);
  await confirmOnboardingModel();
  await screen.findByRole("textbox", { name: "Message Chief" });
  expect(subscriberCounts().attachmentImport).toBe(1);

  for (let cycle = 0; cycle < 10; cycle++) {
    await fireEvent.click(screen.getByRole("button", { name: /^Sales Outbound, Outbound specialist/ }));
    await screen.findByRole("textbox", { name: "Message Sales Outbound" });
    expect(subscriberCounts().attachmentImport).toBe(1);
    await fireEvent.click(screen.getByRole("button", { name: /^Chief, Chief of staff/ }));
    await screen.findByRole("textbox", { name: "Message Chief" });
    expect(subscriberCounts().attachmentImport).toBe(1);
  }

  importImage("synthetic-one", "synthetic-one", "synthetic-screenshot.png");
  expect(await screen.findAllByRole("button", { name: "Remove synthetic-screenshot.png" })).toHaveLength(1);

  // Different images can have the same filename. A later paste is also intentional.
  importImage("synthetic-distinct", "synthetic-two", "synthetic-screenshot.png");
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "Remove synthetic-screenshot.png" })).toHaveLength(2),
  );
  importImage("synthetic-repeat", "synthetic-three", "synthetic-screenshot.png");
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "Remove synthetic-screenshot.png" })).toHaveLength(3),
  );

  await fireEvent.click(await screen.findByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(window.openbot.agent.sendMessage).toHaveBeenCalledExactlyOnceWith(
      {
        agentId: "chief",
        text: "",
        attachmentDraftIds: ["synthetic-one", "synthetic-two", "synthetic-three"],
        clientMessageId: expect.any(String),
      },
      "local",
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Remove synthetic-screenshot.png" })).not.toBeInTheDocument(),
  );

  await fireEvent.click(screen.getByRole("button", { name: /^Sales Outbound, Outbound specialist/ }));
  const composer = await screen.findByRole("textbox", { name: "Message Sales Outbound" });
  composer.textContent = "Keep this agent draft";
  await fireEvent.input(composer);
  importImage("synthetic-agent", "synthetic-agent", "synthetic-agent.png");
  await screen.findByRole("button", { name: "Remove synthetic-agent.png" });

  await fireEvent.click(screen.getByRole("button", { name: /^Chief, Chief of staff/ }));
  expect(await screen.findByRole("textbox", { name: "Message Chief" })).toHaveTextContent("");
  expect(screen.queryByRole("button", { name: "Remove synthetic-agent.png" })).not.toBeInTheDocument();
  await fireEvent.click(screen.getByRole("button", { name: /^Sales Outbound, Outbound specialist/ }));
  expect(await screen.findByRole("textbox", { name: "Message Sales Outbound" })).toHaveTextContent(
    "Keep this agent draft",
  );
  expect(await screen.findAllByRole("button", { name: "Remove synthetic-agent.png" })).toHaveLength(1);
  expect(window.openbot.agent.discardDraftAttachment).not.toHaveBeenCalled();
  expect(subscriberCounts().attachmentImport).toBe(1);

  view.unmount();
  expect(subscriberCounts().attachmentImport).toBe(0);
});
