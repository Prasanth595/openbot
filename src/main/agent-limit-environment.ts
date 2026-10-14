import { AGENT_ROSTER_ITEMS_LIMIT, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("agent-limit");

/** Read once at the host boundary. Hosted plans keep the shipped cap. */
export function agentLimitForHost(environment: NodeJS.ProcessEnv, hosted: boolean): number {
  if (hosted) return INPUT_LIMITS.agents;
  const configured = environment.OPENBOT_AGENT_LIMIT?.trim();
  if (!configured) return INPUT_LIMITS.agents;
  const limit = Number(configured);
  if (/^[1-9][0-9]*$/u.test(configured) && Number.isSafeInteger(limit) && limit <= AGENT_ROSTER_ITEMS_LIMIT)
    return limit;
  logger.warn("OPENBOT_AGENT_LIMIT is not valid. The host uses the default agent limit.");
  return INPUT_LIMITS.agents;
}
