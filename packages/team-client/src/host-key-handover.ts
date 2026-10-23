import { sha256 } from "@noble/hashes/sha2.js";
import { type HostKeyHandover, hostKeyHandoverStatement } from "@openbot/contracts/host-key-handover";
import { Effect } from "effect";
import { base64UrlToBytes, bytesToBase64Url } from "./base64";
import { verifyEd25519Pem } from "./ed25519";

export function remoteHostFingerprint(publicKey: string): string {
  const digest = sha256(new TextEncoder().encode(publicKey));
  return bytesToBase64Url(digest);
}

/**
 * Whether the handover chain leads from the key this client trusts to the key that the account
 * service advertises now. Each step counts only when the key before it and its own key both signed
 * it. A step that matches but does not verify stops the walk: the client keeps its pin.
 */
export const followHostKeyHandovers = Effect.fn("HostKeyHandover.follow")(function* (input: {
  hostId: string;
  trustedFingerprint: string;
  advertisedPublicKey: string;
  handovers: readonly HostKeyHandover[];
}): Effect.fn.Return<boolean> {
  const target = remoteHostFingerprint(input.advertisedPublicKey);
  let current = input.trustedFingerprint;
  for (const handover of input.handovers) {
    if (current === target) break;
    if (handover.hostId !== input.hostId || remoteHostFingerprint(handover.previousPublicKey) !== current) continue;
    const statement = new TextEncoder().encode(hostKeyHandoverStatement(handover));
    const signedByPrevious = yield* verifySignature(handover.previousSignature, statement, handover.previousPublicKey);
    const signedByNext =
      signedByPrevious && (yield* verifySignature(handover.signature, statement, handover.publicKey));
    if (!signedByNext) return false;
    current = remoteHostFingerprint(handover.publicKey);
  }
  return current === target;
});

function verifySignature(signature: string, message: Uint8Array, publicKey: string): Effect.Effect<boolean> {
  return Effect.suspend(() => verifyEd25519Pem(base64UrlToBytes(signature), message, publicKey)).pipe(
    Effect.catch(() => Effect.succeed(false)),
  );
}
