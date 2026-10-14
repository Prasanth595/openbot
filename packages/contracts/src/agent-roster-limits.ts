/** The existing HTTPS Team event budget. Large rosters keep this resource bound. */
export const AGENT_ROSTER_BYTES_LIMIT = 1024 * 1024;

// Each JSON array entry requires at least its value and a separator. This is a cheap admission
// check before serialization, not a new product count cap. The encoded byte check is authoritative.
export const AGENT_ROSTER_ITEMS_LIMIT = Math.floor(AGENT_ROSTER_BYTES_LIMIT / 2);

export function fitsAgentRosterBudget(value: unknown): boolean {
  try {
    const encoded = JSON.stringify(value);
    return encoded !== undefined && new TextEncoder().encode(encoded).byteLength <= AGENT_ROSTER_BYTES_LIMIT;
  } catch {
    return false;
  }
}

export function isBoundedAgentRoster(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  // Keep released local collection behaviour, including transfer previews with embedded avatars.
  if (value.length <= 100) return true;
  return value.length <= AGENT_ROSTER_ITEMS_LIMIT && fitsAgentRosterBudget(value);
}
