import type {
  AgentSummary,
  ConversationSnapshot,
  InstalledSkill,
  Routine,
  SendMessageInput,
} from "@openbot/contracts/ipc";
import { type AppTextKey, translateFor } from "@openbot/i18n";
import type { MockOpenBotOptions } from "./mock-openbot";

export interface PreviewUseCaseAction {
  id: string;
  agentId: string;
  labelKey: AppTextKey;
  prompt: string;
  result: string;
}

/** Version 1 is static data. It cannot contain scripts, URLs, secrets, or provider callbacks. */
export interface PreviewUseCaseManifest {
  version: 1;
  id: string;
  titleKey: AppTextKey;
  agents: AgentSummary[];
  actions: PreviewUseCaseAction[];
  routines: Record<string, Routine[]>;
  skills: Record<string, InstalledSkill[]>;
  files: Record<string, { content: string; mimeType: string }>;
}

const NOW = "2026-10-01T09:00:00.000Z";
const t = translateFor("en");
const agentProfiles: Pick<AgentSummary, "id" | "name" | "title" | "description" | "avatarHue">[] = [
  {
    id: "campaign",
    name: "Campaign",
    title: "Campaign coordinator",
    description: "Plans the sample campaign and records approvals.",
    avatarHue: 245,
  },
  {
    id: "research",
    name: "Research",
    title: "Audience researcher",
    description: "Reviews synthetic audience notes and cites the sample brief.",
    avatarHue: 185,
  },
  {
    id: "content",
    name: "Content",
    title: "Content and reporting partner",
    description: "Drafts sample content, client updates, and weekly reports.",
    avatarHue: 320,
  },
];
const agents: AgentSummary[] = agentProfiles.map(
  (agent): AgentSummary => ({
    ...agent,
    provider: "codex",
    notifications: false,
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    threadId: `demo-thread-${agent.id}`,
    workspacePath: `/mock/OpenBot/Agents/${agent.id}`,
    preview: "Synthetic Cedar Studio campaign",
    updatedAt: NOW,
    avatarSeed: `marketing-${agent.id}`,
    avatarUrl: null,
  }),
);

const actions: PreviewUseCaseAction[] = [
  {
    id: "plan",
    agentId: "campaign",
    labelKey: "preview.demo.plan",
    prompt: "Plan Cedar Studio's sample autumn campaign.",
    result:
      "## Campaign plan\n\nClient: Cedar Studio, a fictional home-goods brand. Goal: 40 qualified enquiries over four weeks. Sample budget: $4,000.\n\n| Work | Owner | Next step |\n| --- | --- | --- |\n| Audience evidence | @Research | Review audience-notes.md |\n| Content drafts | @Content | Prepare two draft posts |\n| Client review | @Campaign | Get human approval |\n\nWeek 1: research and draft. Weeks 2 and 3: approved launch and review. Week 4: report. No campaign is published. See [campaign brief](campaign-brief.md).",
  },
  {
    id: "research",
    agentId: "research",
    labelKey: "preview.demo.research",
    prompt: "Research the sample campaign audience.",
    result:
      "## Audience brief\n\nThe synthetic interview set contains 12 responses. Eight mention small homes. Seven prefer durable materials. These overlapping sample groups are not a population estimate.\n\nRecommendation: test a small-space message against a durable-material message. Ask @Content to draft both. Source: [sample audience notes](audience-notes.md). No website was visited.",
  },
  {
    id: "content",
    agentId: "content",
    labelKey: "preview.demo.content",
    prompt: "Draft two posts for the sample campaign.",
    result:
      "## Draft posts\n\n**Small spaces:** A calmer corner starts with one useful piece. Explore Cedar Studio's compact collection.\n\n**Durable materials:** Choose fewer pieces. Choose materials made to last. Meet the fictional Cedar Studio collection.\n\n@Campaign must check claims and approve the final copy. These drafts are not posted. See [content drafts](content-drafts.md).",
  },
  {
    id: "client",
    agentId: "campaign",
    labelKey: "preview.demo.client",
    prompt: "Draft a client update for the sample campaign.",
    result:
      "## Client update draft\n\nHello Cedar Studio,\n\nThe audience brief and two content drafts are ready. Please approve the message direction and confirm the $4,000 sample budget. We will wait for your approval before any launch.\n\nNext review: Friday at 09:00 UTC.\n\nThis is a local sample draft. No email or message is sent.",
  },
  {
    id: "report",
    agentId: "content",
    labelKey: "preview.demo.report",
    prompt: "Prepare the sample weekly campaign report.",
    result:
      "## Weekly report\n\nAll figures are fictional.\n\n| Metric | Sample value |\n| --- | --- |\n| Visits | 1,200 |\n| Enquiries | 24 |\n| Enquiry rate | 2% |\n| Spend | $800 |\n\nThe sample has 24 of its 40 target enquiries. Next: @Research reviews the two messages; @Campaign reviews the remaining sample budget. See [sample metrics](weekly-metrics.csv). No analytics service was contacted.",
  },
];

const reportAction = actions.find((action) => action.id === "report");
if (!reportAction) throw new Error("The marketing report action is missing.");
const reportRoutine: Routine = {
  id: "demo-weekly-report",
  agentId: "content",
  name: "Weekly campaign report",
  instruction: reportAction.prompt,
  active: true,
  timezone: "UTC",
  createdAt: NOW,
  updatedAt: NOW,
  trigger: {
    id: "demo-weekly-report-trigger",
    routineId: "demo-weekly-report",
    schedule: { kind: "weekly", weekday: 5, time: "09:00" },
    nextRunAt: "2026-10-02T09:00:00.000Z",
    createdAt: NOW,
    updatedAt: NOW,
  },
};

export const MARKETING_DEMO_MANIFEST: PreviewUseCaseManifest = {
  version: 1,
  id: "marketing",
  titleKey: "preview.demo.title",
  agents,
  actions,
  routines: { campaign: [], research: [], content: [reportRoutine] },
  skills: Object.fromEntries(
    agents.map((agent): [string, InstalledSkill[]] => [
      agent.id,
      [
        {
          skillId: `demo-${agent.id}-brief`,
          slug: "campaign-brief",
          name: "Campaign brief",
          installedVersion: 1,
          availableVersion: 1,
          state: "installed",
          enabled: true,
          origin: "workspace",
          location: ".agents/skills/campaign-brief",
          description:
            "Use only the synthetic Cedar Studio brief. Require human approval before publishing or sending.",
        },
      ],
    ]),
  ),
  files: {
    "campaign-brief.md": {
      mimeType: "text/markdown",
      content:
        "# Cedar Studio\n\nFictional client. Four-week autumn campaign. Sample budget: $4,000. Goal: 40 qualified enquiries. All publication and client communication require human approval.\n",
    },
    "audience-notes.md": {
      mimeType: "text/markdown",
      content:
        "# Synthetic audience notes\n\nTwelve invented responses. Eight mention small homes. Seven prefer durable materials. Groups overlap. No real research or personal data is included.\n",
    },
    "content-drafts.md": {
      mimeType: "text/markdown",
      content:
        "# Draft content\n\nSmall spaces: A calmer corner starts with one useful piece.\n\nDurable materials: Choose fewer pieces. Choose materials made to last.\n\nHuman approval is required. These drafts are not published.\n",
    },
    "weekly-metrics.csv": {
      mimeType: "text/csv",
      content: "metric,synthetic_value\nvisits,1200\nenquiries,24\nenquiry_rate,0.02\nspend_usd,800\n",
    },
  },
};

export function createUseCaseOptions(manifest: PreviewUseCaseManifest): MockOpenBotOptions {
  const snapshots: Record<string, ConversationSnapshot> = Object.fromEntries(
    manifest.agents.map((agent): [string, ConversationSnapshot] => [
      agent.id,
      {
        agentId: agent.id,
        threadId: agent.threadId,
        activeTurnId: null,
        revision: 0,
        messages: [
          {
            id: `demo-welcome-${agent.id}`,
            author: "assistant",
            source: "assistant",
            text: `${t("preview.demo.simulatedResult")}\n\n${agent.description}\n\nThe fictional Cedar Studio brief is ready. Choose a guided example above.`,
            createdAt: NOW,
            status: "completed",
          },
        ],
      },
    ]),
  );
  const replyForMessage = (input: SendMessageInput): string => {
    const action = manifest.actions.find(
      (candidate) => candidate.agentId === input.agentId && candidate.prompt === input.text,
    );
    return action ? `${t("preview.demo.simulatedResult")}\n\n${action.result}` : t("preview.demo.unsupported");
  };
  return {
    appInfo: { name: "OpenBot", version: "0.24.0", platform: "darwin", variant: "preview" },
    updateStatus: {
      phase: "idle",
      currentVersion: "0.24.0",
      availableVersion: null,
      progress: null,
      checkedAt: NOW,
      message: null,
      errorCode: null,
    },
    usage: { limits: [] },
    models: [
      {
        provider: "codex",
        id: "gpt-5.6-luna",
        name: "Simulated demo",
        description: "No live model is connected.",
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: ["low"],
      },
    ],
    analyticsPreference: { enabled: false },
    languagePreference: { language: "en" },
    authState: {
      status: "signed_in",
      user: { id: "demo-visitor", email: "visitor@example.test", name: "Demo visitor", avatarUrl: null },
    },
    setupState: { completed: true, preferredProvider: "codex", preferredModel: null },
    agentStatus: {
      phase: "ready",
      cliVersion: null,
      auth: { kind: "unknown" },
      capabilities: { chat: "ready", browser: "unavailable", computerUse: "unavailable" },
      message: null,
      fullAccess: true,
      providers: [
        { id: "codex", state: "available", version: null, email: null, message: t("preview.demo.simulatedResult") },
      ],
    },
    agents: manifest.agents,
    snapshots,
    queues: Object.fromEntries(manifest.agents.map((agent) => [agent.id, []])),
    servers: [
      {
        id: "local",
        name: "Cedar Studio demo",
        logoUrl: null,
        notificationsMuted: true,
        notificationsMutedUntil: null,
        notificationLevel: "nothing",
        kind: "local",
        state: "online",
        apiUrl: null,
        remoteDesktopAvailable: false,
        role: null,
        active: true,
      },
    ],
    directThreads: [],
    directSnapshots: {},
    teamMembers: [],
    invites: [],
    sessions: [],
    presence: { serverId: "local", members: [], updatedAt: NOW },
    browserTabs: [],
    browserControlState: { sessions: [] },
    browserPreview: null,
    remoteDesktopSessions: [],
    routines: manifest.routines,
    routineRuns: {},
    routineFlowLinks: [],
    routineFlowSteps: [],
    memories: {},
    tables: [],
    customProviders: [],
    installedSkills: manifest.skills,
    localSkills: [],
    workspaceFiles: manifest.files,
    replyForMessage,
    replyDelayMs: 400,
  };
}
