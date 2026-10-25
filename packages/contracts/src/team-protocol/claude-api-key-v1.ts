// Frozen optional claude-api-key-v1 marker.
//
// What it grants, recorded here because freezing it makes it permanent: nothing new on the wire. It
// tells a client that the host reads a Claude key saved through the released `apiKeySet` route of
// providers-v1, v5 or v8: the host gives the key to the Claude CLI of its own sign-in as
// `ANTHROPIC_API_KEY`, before its claude.ai account. An older host stores such a key and never reads
// it, so a client offers the key only when the host advertises this. The routes, their admin gate and
// their bounds stay as each released provider protocol defines them. Widening any of it needs a
// second capability string.
export const CLAUDE_API_KEY_CAPABILITY = "claude-api-key-v1";
