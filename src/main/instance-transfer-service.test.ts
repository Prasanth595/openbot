import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import type {
  AgentMemory,
  AgentSummary,
  AvatarImageInput,
  ConnectRoutineFlowInput,
  CreateRoutineInput,
  McpServerConfig,
  Routine,
  SaveCustomAgentInput,
  SaveCustomProviderInput,
  SetAgentMemoryInclusionInput,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { InstanceTransferService, type TransferPreferences } from "./instance-transfer-service";
import { LocalSkillLibrary } from "./local-skill-library";
import { SkillMarketplaceFailure } from "./skill-marketplace-service";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SKILL = "---\nname: Web brief\ndescription: Write a short cited brief.\n---\nSearch, then cite.";
const PREFERENCES: TransferPreferences = {
  language: "pl",
  logoColor: "blue",
  desktopNotifications: true,
  messagePreview: false,
  busyMessageMode: "steer",
  agentMemoryLimit: 128,
};
const SCHEDULE = { kind: "daily", time: "09:00" } as const;
const GITHUB_MCP: McpServerConfig = {
  id: "mcp-1",
  name: "GitHub",
  transport: "stdio",
  enabled: true,
  command: "npx",
  args: [
    "github-mcp",
    "--access-token",
    "ghp_arg_secret",
    "--read-only",
    "postgresql://app:pg_secret@db.local/app",
    "--dsn=mysql://root:dsn_secret@db.local/app",
  ],
  env: [{ key: "GITHUB_TOKEN", value: "ghp_secret" }],
  envPassthrough: [],
  workingDirectory: "",
  url: "",
  headers: [{ key: "Authorization", value: "Bearer secret" }],
};

/** One OpenBot computer: an agent service, a skill library and the app settings, held in memory. */
interface Computer {
  root: string;
  agents: AgentSummary[];
  routines: Map<string, Routine[]>;
  memories: Map<string, AgentMemory[]>;
  inclusions: SetAgentMemoryInclusionInput[];
  avatars: Map<string, AvatarImageInput | null>;
  updates: UpdateAgentInput[];
  mcpServers: McpServerConfig[];
  customProviders: SaveCustomProviderInput[];
  customAgents: SaveCustomAgentInput[];
  preferences: TransferPreferences;
  providersOff: AgentProviderId[];
  layout: SidebarLayoutSnapshot;
  links: ConnectRoutineFlowInput[];
  installLocal: Mock<(input: { agentId: string; skillId: string; revision: number }) => Promise<void>>;
  library: LocalSkillLibrary;
  service: InstanceTransferService;
}

let base: string;

async function computer(name: string): Promise<Computer> {
  const root = join(base, name);
  await mkdir(join(root, "Shared"), { recursive: true });
  const state: Omit<Computer, "library" | "service"> = {
    root,
    agents: [],
    routines: new Map(),
    memories: new Map(),
    inclusions: [],
    avatars: new Map(),
    updates: [],
    mcpServers: [],
    customProviders: [],
    customAgents: [],
    preferences: { ...PREFERENCES, language: "en", busyMessageMode: "queue" },
    providersOff: [],
    layout: { revision: 1, sections: [], order: ["people", "unassigned"], agentAssignments: {}, agentOrder: [] },
    links: [],
    installLocal: vi.fn(async () => undefined),
  };
  const library = new LocalSkillLibrary(join(root, "library"), () => state.agents);
  const find = (agentId: string) => {
    const agent = state.agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error("Unknown agent.");
    return agent;
  };
  const service = new InstanceTransferService({
    sharedRoot: join(root, "Shared"),
    appVersion: "0.9.4",
    timezone: () => "Europe/Warsaw",
    agents: {
      listAgents: () => state.agents,
      listRoutines: (agentId) => state.routines.get(agentId) ?? [],
      listMemories: (agentId) => state.memories.get(agentId) ?? [],
      getMemorySelection: (agentId) => ({
        selections: (state.memories.get(agentId) ?? []).map((memory, index) => ({
          memoryId: memory.id,
          inclusion: index === 0 ? "essential" : "searchable",
          userControlled: index === 0,
          revision: 3,
        })),
      }),
      setMemoryInclusion: (input) => state.inclusions.push(input),
      resolveAvatar: (agentId) =>
        state.avatars.get(agentId) ? { path: join(root, "avatars", `${agentId}.png`), mimeType: "image/png" } : null,
      listModels: () => [{ provider: "claude", id: "claude-opus-5-5" }],
      createAgentProfile: (input) =>
        Effect.promise(async () => {
          const id = `${name}-agent-${state.agents.length + 1}`;
          const agent: AgentSummary = {
            id,
            name: input.name,
            title: input.title ?? "",
            description: input.description,
            provider: input.provider ?? "codex",
            notifications: true,
            model: input.model ?? "gpt-5.6-luna",
            reasoningEffort: input.reasoningEffort ?? "medium",
            threadId: null,
            workspacePath: join(root, "workspaces", id),
            preview: "",
            updatedAt: null,
            avatarSeed: input.avatarSeed,
            avatarHue: input.avatarHue,
            avatarUrl: null,
          };
          await mkdir(agent.workspacePath, { recursive: true });
          state.agents.push(agent);
          return agent;
        }),
      updateAgent: (input) =>
        Effect.sync(() => {
          state.updates.push(input);
          return find(input.agentId);
        }),
      createRoutine: (input: CreateRoutineInput) => {
        const list = state.routines.get(input.agentId) ?? [];
        const routine = routineFixture(`${input.agentId}-routine-${list.length + 1}`, input);
        state.routines.set(input.agentId, [...list, routine]);
        return routine;
      },
      createMemory: (input) => {
        const list = state.memories.get(input.agentId) ?? [];
        const memory = memoryFixture(`${input.agentId}-memory-${list.length + 1}`, input.agentId, input.text);
        state.memories.set(input.agentId, [...list, memory]);
        return memory;
      },
      memoryLimit: () => 64,
      initializeMemorySelection: () => undefined,
      setAvatar: (agentId, image) =>
        Effect.sync(() => {
          state.avatars.set(agentId, image);
          return find(agentId);
        }),
      deleteAgent: (agentId) =>
        Effect.sync(() => {
          state.agents = state.agents.filter((agent) => agent.id !== agentId);
        }),
    },
    skills: {
      library: () => library,
      installLocal: (input) =>
        Effect.tryPromise({
          try: () => state.installLocal(input),
          catch: (cause) => new SkillMarketplaceFailure({ cause }),
        }),
    },
    settings: {
      mcpServers: () => state.mcpServers,
      saveMcpServer: (config) =>
        Effect.sync(() => state.mcpServers.push({ ...config, id: `mcp-${state.mcpServers.length + 1}` })),
      customProviders: () =>
        state.customProviders.map((provider) => ({
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          hasApiKey: provider.apiKey !== null,
          models: provider.models,
        })),
      saveCustomProvider: (input) => Effect.sync(() => state.customProviders.push(input)),
      customAgents: () =>
        Effect.succeed(
          state.customAgents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            command: agent.command,
            args: agent.args,
            envNames: agent.env.map((variable) => variable.name),
            resolvedCommand: null,
          })),
        ),
      saveCustomAgent: (input) => Effect.sync(() => state.customAgents.push(input)),
      defaults: () => Effect.succeed({ provider: "claude", model: "claude-opus-5-5" }),
      saveDefaults: () => Effect.void,
      providersOff: () => state.providersOff,
      setProviderOn: (provider, on) =>
        Effect.sync(() => {
          state.providersOff = on
            ? state.providersOff.filter((id) => id !== provider)
            : [...state.providersOff, provider];
        }),
      preferences: () => state.preferences,
      savePreferences: (preferences) =>
        Effect.sync(() => {
          state.preferences = preferences;
        }),
      sidebar: () => state.layout,
      mutateSidebar: (action: SidebarLayoutAction) =>
        Effect.sync(() => {
          if (action.type === "create")
            state.layout = {
              ...state.layout,
              sections: [
                ...state.layout.sections,
                { id: `section-${state.layout.sections.length + 1}`, name: action.name },
              ],
            };
          if (action.type === "assign" && action.sectionId)
            state.layout = {
              ...state.layout,
              agentAssignments: { ...state.layout.agentAssignments, [action.agentId]: action.sectionId },
            };
          return state.layout;
        }),
      routineFlowLinks: (agentId) =>
        Effect.succeed(
          state.links
            .filter((link) => link.fromAgentId === agentId)
            .map((link, index) => ({
              id: `link-${index}`,
              ...link,
              instruction: link.instruction ?? "",
              createdAt: "",
            })),
        ),
      connectRoutineFlow: (input) => Effect.sync(() => state.links.push(input)),
      signedInProviders: () => (name === "old" ? ["claude", "codex"] : ["codex"]),
    },
  });
  return Object.assign(state, { library, service });
}

function memoryFixture(id: string, agentId: string, text: string): AgentMemory {
  return { id, agentId, text, origin: "manual", sourceTurnId: null, createdAt: "", updatedAt: "" };
}

function routineFixture(id: string, input: Omit<CreateRoutineInput, "agentId"> & { agentId: string }): Routine {
  return {
    id,
    agentId: input.agentId,
    name: input.name,
    instruction: input.instruction,
    active: input.active,
    timezone: input.timezone,
    trigger: {
      id: `${id}-trigger`,
      routineId: id,
      schedule: input.schedule,
      nextRunAt: "",
      createdAt: "",
      updatedAt: "",
    },
    ...(input.limitPolicy ? { limitPolicy: input.limitPolicy } : {}),
    ...(input.missedPolicy ? { missedPolicy: input.missedPolicy } : {}),
    createdAt: "",
    updatedAt: "",
  };
}

/** The old computer: one agent with a skill, a routine, memories, an avatar, files and secrets. */
async function oldComputer(): Promise<Computer> {
  const old = await computer("old");
  const workspace = join(old.root, "workspaces", "research");
  const agent: AgentSummary = {
    id: "research",
    name: "Research",
    title: "Analyst",
    description: "You find sources.",
    provider: "claude",
    notifications: false,
    model: "claude-opus-5-5",
    reasoningEffort: "high",
    busyMessageMode: "steer",
    access: "full",
    computerUse: true,
    allowAutomation: true,
    threadId: null,
    workspacePath: workspace,
    preview: "",
    updatedAt: null,
    avatarSeed: "research-seed",
    avatarHue: null,
    avatarUrl: null,
  };
  old.agents.push(agent);
  await mkdir(join(workspace, "notes"), { recursive: true });
  await writeFile(join(workspace, "notes", "plan.md"), "Plan");
  await writeFile(join(workspace, ".env"), "TOKEN=secret");
  await mkdir(join(workspace, ".git"), { recursive: true });
  await writeFile(join(workspace, ".git", "config"), "[core]");
  await mkdir(join(workspace, ".openbot"), { recursive: true });
  await writeFile(join(workspace, ".openbot", "skills-lock.json"), "{}");
  await mkdir(join(workspace, ".agents", "skills", "web-brief"), { recursive: true });
  await writeFile(join(workspace, ".agents", "skills", "web-brief", "SKILL.md"), SKILL);
  await mkdir(join(workspace, ".agents", "skills", "openbot-site-hosting"), { recursive: true });
  await writeFile(join(workspace, ".agents", "skills", "openbot-site-hosting", "SKILL.md"), SKILL);
  await writeFile(join(workspace, ".agents", "skills", "openbot-site-hosting", ".openbot-managed.json"), "{}");
  await mkdir(join(old.root, "avatars"), { recursive: true });
  await writeFile(join(old.root, "avatars", "research.png"), PNG);
  old.avatars.set("research", { mimeType: "image/png", bytes: PNG });
  await writeFile(join(old.root, "Shared", "report.csv"), "a,b");
  await mkdir(join(old.root, "Shared", "Data"), { recursive: true });
  await writeFile(join(old.root, "Shared", "Data", "agent-data.db"), "SQLite format 3");
  old.routines.set("research", [
    routineFixture("routine-1", {
      agentId: "research",
      name: "Morning brief",
      instruction: "Write the brief.",
      active: true,
      timezone: "Europe/Warsaw",
      schedule: SCHEDULE,
      missedPolicy: "run-once",
    }),
  ]);
  old.memories.set("research", [
    memoryFixture("memory-1", "research", "The user reports in EUR."),
    memoryFixture("memory-2", "research", "Weekly calls on Monday."),
  ]);
  old.links.push({
    routineId: "routine-1",
    fromAgentId: "research",
    toAgentId: "research",
    instruction: "Pass it on.",
  });
  old.mcpServers.push(GITHUB_MCP, {
    ...GITHUB_MCP,
    id: "mcp-2",
    name: "Linear",
    transport: "http",
    command: "",
    args: [],
    env: [],
    headers: [],
    url: "https://mcp.example.com/api/mcp/s/path_secret/mcp?api_key=url_secret",
  });
  old.customProviders.push({
    id: "together",
    name: "Together",
    baseUrl: "https://user:pw_secret@api.together.xyz/v1?key=provider_secret",
    apiKey: "sk-secret",
    models: [{ id: "llama", name: "Llama" }],
    headers: [{ name: "X-Key", value: "header-secret" }],
  });
  old.customAgents.push({
    id: "goose",
    name: "Goose",
    command: "goose",
    args: ["acp", "--api-key=agent_arg_secret"],
    env: [{ name: "GOOSE_KEY", value: "env-secret" }],
  });
  old.preferences = PREFERENCES;
  old.providersOff = ["cursor"];
  old.layout = {
    revision: 4,
    sections: [{ id: "work", name: "Work" }],
    order: ["work", "people", "unassigned"],
    agentAssignments: { research: "work" },
    agentOrder: ["research"],
  };
  return old;
}

async function exportOld(old: Computer, options = { includeFiles: true, includeSettings: true }): Promise<string> {
  const path = join(base, "openbot-transfer.zip");
  await runCauseEffect(old.service.exportTo(path, { agentIds: ["research"], ...options }));
  return path;
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "openbot-instance-transfer-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("InstanceTransferService", () => {
  it("writes no secret and none of OpenBot's own files into the export", async () => {
    const path = await exportOld(await oldComputer());
    const bytes = await readFile(path);
    const entries = Object.keys(unzipSync(bytes));
    expect(entries).toContain("agents/research/workspace/notes/plan.md");
    expect(entries).toContain("agents/research/skills/web-brief/SKILL.md");
    expect(entries).toContain("shared/report.csv");
    expect(
      entries.filter((name) => /\.env|\.git\/|\.openbot\/|openbot-site-hosting|agent-data\.db/u.test(name)),
    ).toEqual([]);
    const text = new TextDecoder().decode(bytes);
    for (const secret of [
      "ghp_secret",
      "Bearer secret",
      "sk-secret",
      "header-secret",
      "env-secret",
      "TOKEN=secret",
      "ghp_arg_secret",
      "url_secret",
      "pw_secret",
      "provider_secret",
      "agent_arg_secret",
      "pg_secret",
      "dsn_secret",
      "path_secret",
    ])
      expect(text).not.toContain(secret);
    // The file appears only when it is complete.
    expect(await readdir(base)).not.toContain("openbot-transfer.zip.part");
  });

  it("moves an agent and the app settings to another computer", async () => {
    const path = await exportOld(await oldComputer());
    const target = await computer("new");
    target.mcpServers.push({ ...GITHUB_MCP, id: "mine", command: "my-github" });

    const preview = await runCauseEffect(target.service.stage(path));
    expect(
      preview.agents.map((agent) => [agent.name, agent.skillCount, agent.routineCount, agent.memoryCount]),
    ).toEqual([["Research", 1, 1, 2]]);
    const result = await runCauseEffect(
      target.service.apply({ token: preview.token, keys: ["research"], includeSettings: true }),
    );

    const [agent] = result.agents;
    expect(result.skipped).toEqual([]);
    expect(agent).toMatchObject({
      name: "Research",
      title: "Analyst",
      description: "You find sources.",
      provider: "claude",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
      avatarSeed: "research-seed",
    });
    if (!agent) return;
    // Files go to the workspace root, so the paths the agent knows still work.
    expect(await readFile(join(agent.workspacePath, "notes", "plan.md"), "utf8")).toBe("Plan");
    expect(await readFile(join(target.root, "Shared", "report.csv"), "utf8")).toBe("a,b");
    const [skill] = await runCauseEffect(target.library.list());
    expect(target.installLocal).toHaveBeenCalledWith({ agentId: agent.id, skillId: skill?.id, revision: 1 });
    expect(target.routines.get(agent.id)?.map((routine) => [routine.name, routine.missedPolicy])).toEqual([
      ["Morning brief", "run-once"],
    ]);
    expect(target.memories.get(agent.id)?.map((memory) => memory.text)).toEqual([
      "The user reports in EUR.",
      "Weekly calls on Monday.",
    ]);
    expect(target.inclusions[0]?.changes).toEqual([
      { memoryId: `${agent.id}-memory-1`, inclusion: "essential", expectedRevision: 3 },
    ]);
    expect(target.avatars.get(agent.id)).toEqual({ mimeType: "image/png", bytes: PNG });
    // No access, Computer Use or automation setting travels: the agent keeps this computer's defaults.
    expect(target.updates).toEqual([{ agentId: agent.id, notifications: false, busyMessageMode: "steer" }]);

    // An MCP server with a name that is already here is kept as it is.
    // A server is added turned off, because a file can name any command.
    expect(
      target.mcpServers.map((server) => [server.name, server.command, server.enabled, server.url, server.args]),
    ).toEqual([
      ["GitHub", "my-github", true, "", GITHUB_MCP.args],
      ["Linear", "", false, "https://mcp.example.com", []],
    ]);
    expect(target.customProviders).toEqual([
      {
        id: "together",
        name: "Together",
        baseUrl: "https://api.together.xyz/v1",
        apiKey: null,
        models: [{ id: "llama", name: "Llama" }],
        headers: [],
      },
    ]);
    expect(target.customAgents).toEqual([
      { id: "goose", name: "Goose", command: "goose", args: ["acp", "--api-key="], env: [] },
    ]);
    expect(target.preferences).toEqual(PREFERENCES);
    expect(target.providersOff).toEqual(["cursor"]);
    expect(target.layout.sections.map((section) => section.name)).toEqual(["Work"]);
    expect(target.layout.agentAssignments[agent.id]).toBe("section-1");
    expect(target.links).toEqual([
      { routineId: `${agent.id}-routine-1`, fromAgentId: agent.id, toAgentId: agent.id, instruction: "Pass it on." },
    ]);
    expect(result.signIn).toEqual(["claude"]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "Together: enter its API key again in Settings.",
        "Goose: enter the values of GOOSE_KEY again in Settings.",
        "Goose: values that can hold a secret were removed from its arguments or address. Enter them again in Settings.",
        "Together: values that can hold a secret were removed from its arguments or address. Enter them again in Settings.",
        "Linear: the MCP server is added turned off. Check its command, enter its values and full address again, and turn it on in MCP settings.",
      ]),
    );
  });

  it("adds no app setting when the user leaves them out", async () => {
    const path = await exportOld(await oldComputer());
    const target = await computer("new");
    const preview = await runCauseEffect(target.service.stage(path));
    await runCauseEffect(target.service.apply({ token: preview.token, keys: ["research"], includeSettings: false }));
    expect(target.mcpServers).toEqual([]);
    expect(target.customProviders).toEqual([]);
    expect(target.preferences.language).toBe("en");
  });

  it("deletes an agent that fails to import and still imports the others", async () => {
    const old = await oldComputer();
    const [research] = old.agents;
    if (!research) throw new Error("The old computer has no agent.");
    old.agents.push({ ...research, id: "inbox", name: "Inbox" });
    const path = join(base, "two.zip");
    await runCauseEffect(
      old.service.exportTo(path, { agentIds: ["research", "inbox"], includeFiles: false, includeSettings: false }),
    );
    const target = await computer("new");
    target.installLocal.mockRejectedValueOnce(new Error("Install failed."));
    const preview = await runCauseEffect(target.service.stage(path));
    const result = await runCauseEffect(
      target.service.apply({ token: preview.token, keys: ["research", "inbox"], includeSettings: false }),
    );
    expect(result.skipped.map((entry) => [entry.name, entry.reason])).toEqual([["Research", "Install failed."]]);
    expect(target.agents.map((agent) => agent.name)).toEqual(["Inbox"]);
  });

  it("offers the valid agents of a file with one invalid agent", async () => {
    const target = await computer("new");
    const valid = {
      key: "inbox",
      name: "Inbox",
      title: "",
      description: "",
      avatarSeed: "inbox",
      avatarHue: null,
      avatar: null,
      provider: "codex",
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      notifications: true,
      skills: [],
      files: null,
      routines: [],
      memories: [],
    };
    const path = join(base, "partly.zip");
    await writeFile(
      path,
      zipSync({
        "openbot-transfer.json": new TextEncoder().encode(
          JSON.stringify({
            format: "openbot-instance-transfer",
            version: 1,
            source: { appVersion: "0.9.4", exportedAt: null },
            agents: [{ ...valid, key: "bad", skills: ["agents/other/skills/x"] }, valid],
            settings: null,
            shared: null,
            signedIn: [],
          }),
        ),
      }),
    );
    const preview = await runCauseEffect(target.service.stage(path));
    expect(preview.agents.map((agent) => agent.key)).toEqual(["inbox"]);
    expect(preview.warnings).toEqual(["Agent 1 in the file is invalid, so it is skipped."]);
  });

  it("refuses a file made by a newer version", async () => {
    const target = await computer("new");
    const path = join(base, "newer.zip");
    await writeFile(
      path,
      zipSync({
        "openbot-transfer.json": new TextEncoder().encode(
          JSON.stringify({
            format: "openbot-instance-transfer",
            version: 2,
            source: { appVersion: "9.0.0", exportedAt: null },
            agents: [],
            settings: null,
            shared: null,
            signedIn: [],
          }),
        ),
      }),
    );
    await expect(runCauseEffect(target.service.stage(path))).rejects.toThrow(
      "A newer version of OpenBot made this file. Update OpenBot and try again.",
    );
  });
});
