import type { InstalledSkill } from "@openbot/contracts/ipc";

/**
 * The skills the user assigned, as the desktop agent settings list them: built-in skills are hidden.
 * The agent page and the Marketplace keep this list under the same query key.
 */
export function userAssignedSkills(skills: InstalledSkill[]): InstalledSkill[] {
  return skills
    .filter(
      (skill) =>
        skill.origin !== "managed" && skill.slug !== "openbot-site-hosting" && skill.skillId !== "openbot-site-hosting",
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}
