import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { agentSkillsQuery } from "@/features/agents/model/agent-skills-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import type { MentionSkill } from "../components/chat-composer";

const NO_SKILLS: readonly MentionSkill[] = [];

/**
 * The skills that the composer of one agent's chat offers after `@` and in Use skill: the skills the
 * user gave the agent, that are on and not broken. Agent info > Skills reads the same key, so a skill
 * added there or from the Marketplace shows here.
 */
export function useAgentMentionSkills(agentId: string, serverId: string, online: boolean): readonly MentionSkill[] {
  const manage = useMobileWorkspaceSelector((workspace) => workspace.canManageAgentSkills(serverId));
  const { loadAgentSkills } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const skills = useQuery({
    ...agentSkillsQuery(queryScope, serverId, agentId, manage, loadAgentSkills),
    enabled: online,
    staleTime: 60_000,
    retry: false,
  });
  return useMemo(
    () =>
      skills.data
        ? skills.data
            .filter((skill) => skill.enabled !== false && skill.state !== "needs-repair")
            .map((skill) => ({ id: skill.skillId, name: skill.name, description: skill.description ?? "" }))
        : NO_SKILLS,
    [skills.data],
  );
}
