import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  decodeTeamProtocolV2FileControlFrame,
  encodeTeamProtocolV2FileChunk,
  encodeTeamProtocolV2Frame,
} from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Fiber, Result } from "effect";
import { createRemoteFileReceiver } from "../packages/team-client/src/file-download";
import { createRemoteFileSender } from "../packages/team-client/src/file-upload";

const evidenceDirectory = ".openbot-build";
const serviceEvidence = `${evidenceDirectory}/remote-download-cancel-service.json`;
const processEvidence = `${evidenceDirectory}/remote-download-cancel-e2e.json`;

async function runService() {
  const sent: string[] = [];
  const receiver = createRemoteFileReceiver((data) => Effect.sync(() => void sent.push(data)));
  const sender = createRemoteFileSender(
    () => Effect.void,
    () => "upload-owned",
  );
  const checks: string[] = [];
  const bytes = Uint8Array.from([0, 255, 128, 65, 13, 10, 1]);
  const name = "attachment.bin";
  const mimeType = "application/octet-stream";
  const digest = Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const open = (transferId: string) =>
    encodeTeamProtocolV2Frame({
      version: 2,
      type: "file-open",
      transferId,
      name,
      mimeType,
      size: bytes.length,
      sha256: digest,
    });
  const cancel = (transferId: string) =>
    encodeTeamProtocolV2Frame({
      version: 2,
      type: "file-cancel",
      transferId,
      reason: "Private host cancellation detail",
    });
  const receive = (data: string | ArrayBuffer) => Effect.runPromise(receiver.receive(data));
  const startTake = (id: string) => {
    const fiber = Effect.runFork(receiver.take(id).pipe(Effect.result));
    assert.equal(fiber.pollUnsafe(), undefined, "The take waiter must be pending.");
    return fiber;
  };
  async function expectRejection(fiber: ReturnType<typeof startTake>, message: string) {
    const result = await Effect.runPromise(Fiber.join(fiber));
    assert(Result.isFailure(result), "The take waiter must reject.");
    assert.equal(result.failure.message, message);
  }
  async function successfulDownload(id: string) {
    const waiter = startTake(id);
    assert.equal(await receive(open(id)), true);
    assert.equal(
      await receive(new Uint8Array(encodeTeamProtocolV2FileChunk({ transferId: id, offset: 0, bytes })).buffer),
      true,
    );
    assert.equal(await receive(encodeTeamProtocolV2Frame({ version: 2, type: "file-complete", transferId: id })), true);
    const result = await Effect.runPromise(Fiber.join(waiter));
    assert(Result.isSuccess(result), "The download must succeed.");
    assert.deepEqual(result.success, { name, mimeType, base64: btoa(String.fromCharCode(...bytes)) });
    assert.equal(await receive(cancel(id)), false, "A taken download must release its transfer ID.");
  }
  try {
    await successfulDownload("initial");
    checks.push("successful download: exact bytes and metadata");

    assert.equal(await receive(open("active")), true);
    const active = startTake("active");
    assert.equal(
      await receive(
        new Uint8Array(encodeTeamProtocolV2FileChunk({ transferId: "active", offset: 0, bytes: bytes.slice(0, 2) }))
          .buffer,
      ),
      true,
    );
    assert.equal(await receive(cancel("active")), true);
    await expectRejection(active, sourceText("error.remote.attachmentRejected"));
    assert.equal(await receive(cancel("active")), false);
    // Late binary data must cancel only the removed transfer.
    assert.equal(
      await receive(
        new Uint8Array(encodeTeamProtocolV2FileChunk({ transferId: "active", offset: 2, bytes: bytes.slice(2) }))
          .buffer,
      ),
      true,
    );
    const lateReply = sent.at(-1);
    assert(lateReply);
    const lateFrame = decodeTeamProtocolV2FileControlFrame(lateReply);
    assert.equal(lateFrame.type, "file-cancel");
    assert.equal(lateFrame.transferId, "active");
    checks.push("active cancel: waiter rejects with localized text; late chunks stay transfer-local");
    await successfulDownload("active");
    checks.push("successful download after cancel: same receiver and transfer ID");

    const beforeOpen = startTake("before-open");
    assert.equal(await receive(cancel("before-open")), true);
    await expectRejection(beforeOpen, sourceText("error.remote.attachmentRejected"));
    assert.equal(await receive(cancel("before-open")), false);
    await successfulDownload("before-open");
    checks.push("cancel before open: waiter rejects and transfer ID can be reused");

    assert.equal(await receive(open("without-waiter")), true);
    assert.equal(await receive(cancel("without-waiter")), true);
    assert.equal(await receive(cancel("without-waiter")), false);
    checks.push("cancel without waiter: transfer state is removed");

    const unrelated = startTake("unrelated-download");
    const upload = Effect.runFork(
      sender.upload({ name, mimeType, base64: btoa(String.fromCharCode(...bytes)) }).pipe(Effect.result),
    );
    const uploadCancel = cancel("upload-owned");
    assert.equal(await receive(uploadCancel), false, "The receiver must not consume an upload cancel.");
    sender.receive(uploadCancel);
    const uploadResult = await Effect.runPromise(Fiber.join(upload));
    assert(Result.isFailure(uploadResult));
    assert.equal(uploadResult.failure.message, sourceText("error.remote.attachmentRejected"));
    assert.equal(unrelated.pollUnsafe(), undefined, "An unrelated download must stay pending.");
    assert.equal(await receive(cancel("unowned")), false);
    checks.push("unrelated cancel: upload owns its frame and download stays pending");

    assert.equal(await receive(open("cleanup-active")), true);
    const cleanup = startTake("cleanup-active");
    assert.equal(await receive(open("cleanup-no-waiter")), true);
    receiver.clear();
    await expectRejection(cleanup, sourceText("error.remote.attachmentConnectionClosed"));
    await expectRejection(unrelated, sourceText("error.remote.attachmentConnectionClosed"));
    assert.equal(await receive(cancel("cleanup-active")), false);
    assert.equal(await receive(cancel("cleanup-no-waiter")), false);
    receiver.clear();
    checks.push("connection cleanup: active and waiting transfers reject; repeated clear is safe");
    await successfulDownload("after-cleanup");
    checks.push("successful download after connection cleanup");
    await writeFile(
      serviceEvidence,
      `${JSON.stringify({ status: "pass", checks, fixture: { name, mimeType, sha256: digest, bytes: [...bytes] } }, null, 2)}\n`,
    );
  } finally {
    receiver.clear();
    sender.cancel();
  }
}

await mkdir(evidenceDirectory, { recursive: true });
if (process.argv.includes("--service")) {
  try {
    await runService();
  } catch {
    await writeFile(
      serviceEvidence,
      `${JSON.stringify({ status: "fail", error: "Service check failed." }, null, 2)}\n`,
    );
    process.exitCode = 1;
  }
} else {
  // Natural child exit proves that receiver and sender timers were released.
  // This deadline bounds a failed check; it is not a wait for service state.
  await writeFile(serviceEvidence, `${JSON.stringify({ status: "running" }, null, 2)}\n`);
  const child = spawn(process.execPath, [import.meta.filename, "--service"], {
    stdio: "ignore",
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  let deadlineExceeded = false;
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    child.kill();
  }, 5_000);
  let exitCode: number | null;
  try {
    exitCode = await exited;
  } finally {
    clearTimeout(deadline);
  }
  const passed = exitCode === 0 && !deadlineExceeded;
  await writeFile(
    processEvidence,
    `${JSON.stringify(
      { status: passed ? "pass" : "fail", exitCode, deadlineExceeded, naturalExit: passed, serviceEvidence },
      null,
      2,
    )}\n`,
  );
  process.exitCode = passed ? 0 : 1;
}
