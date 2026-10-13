import { sourceText } from "@openbot/i18n/source";
/** Prevents delivery insertion across asynchronous agent deletion and attachment preparation. */
export class MailboxDeliveryGate {
  readonly #blockedAgents = new Map<string, number>();
  readonly #versions = new Map<string, number>();

  block(agentId: string): () => void {
    this.#blockedAgents.set(agentId, (this.#blockedAgents.get(agentId) ?? 0) + 1);
    this.#versions.set(agentId, (this.#versions.get(agentId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.#blockedAgents.get(agentId) ?? 0) - 1;
      if (remaining > 0) this.#blockedAgents.set(agentId, remaining);
      else this.#blockedAgents.delete(agentId);
    };
  }

  prepare(agentIds: string[]): () => void {
    const versions = agentIds.map((id) => this.#versions.get(id) ?? 0);
    const validate = () => {
      if (
        agentIds.some((id, index) => this.#blockedAgents.has(id) || (this.#versions.get(id) ?? 0) !== versions[index])
      ) {
        throw new Error(sourceText("error.backend.recipientDeleting"));
      }
    };
    validate();
    return validate;
  }
}
