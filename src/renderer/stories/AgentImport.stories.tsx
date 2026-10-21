import type { AgentImportResult } from "@openbot/contracts/ipc";
import { Blocks, Download, HardDrive, Monitor, Settings, Tabs, UsersRound } from "@openbot/ui";
import { AgentImportSources } from "@openbot/ui/features/import/AgentImportSources";
import { AgentImportView } from "@openbot/ui/features/import/AgentImportView";
import { type HermesImportPhase, HermesImportView } from "@openbot/ui/features/import/HermesImportView";
import { SettingsDialogShell } from "@openbot/ui/features/settings/SettingsDialogShell";
import type { JSX } from "@solidjs/web";
import { createSignal, Match, Switch } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  AGENT_IMPORT_PREVIEW,
  AGENT_IMPORT_SKILL,
  AGENT_IMPORT_WARNINGS,
  HERMES_EXPORT_SKILL,
  HERMES_IMPORT_PREVIEW,
} from "./agent-import-fixtures";
import { FILES_NOW } from "./files-fixtures";
import { STORY_AGENT_SUMMARIES } from "./fixtures";
import { SettingsPageStory } from "./settings-page-story";

const meta = {
  title: "Settings/AgentImport",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type ViewArgs = Parameters<typeof AgentImportView>[0];

const viewArgs = (overrides: Partial<ViewArgs> = {}): ViewArgs => ({
  phase: "idle",
  now: FILES_NOW,
  setup: "agent",
  exportSkill: AGENT_IMPORT_SKILL,
  onSetupChange: fn(),
  onOpenExportAgent: fn(),
  onSaveExportSkill: fn(),
  onChoose: fn(),
  onImport: fn(),
  onCancel: fn(),
  onDone: fn(),
  onOpenAgent: fn(),
  ...overrides,
});

const RESULT: AgentImportResult = {
  agents: STORY_AGENT_SUMMARIES.slice(0, 2),
  skipped: [],
  channels: [{ id: "channel-pipeline", name: "Pipeline review" }],
  skippedChannels: [],
  warnings: [],
};

function Stage(props: { args?: ViewArgs; narrow?: boolean; children?: JSX.Element }) {
  return (
    <main class="files-story-stage">
      <div class="files-story-page" data-narrow={props.narrow ? "true" : undefined}>
        {props.args ? <AgentImportView {...props.args} /> : props.children}
      </div>
    </main>
  );
}

export const Intro: Story = {
  name: "Import: Steps",
  render: () => <Stage args={viewArgs()} />,
};

export const SetUpYourself: Story = {
  name: "Import: Set up the skill yourself",
  render: () => {
    const [setup, setSetup] = createSignal<ViewArgs["setup"]>("agent");
    return <Stage args={viewArgs({ setup: setup(), onSetupChange: setSetup })} />;
  },
};

export const Reading: Story = {
  name: "Import: Reading the export",
  render: () => <Stage args={viewArgs({ phase: "reading" })} />,
};

export const OpenFailed: Story = {
  name: "Import: Export could not be opened",
  render: () => (
    <Stage
      args={viewArgs({
        error: "The export contains an unsafe file: agents/research/files/.env",
      })}
    />
  ),
};

export const Review: Story = {
  name: "Import: Review",
  render: () => <Stage args={viewArgs({ phase: "review", preview: AGENT_IMPORT_PREVIEW })} />,
};

export const ReviewWithWarnings: Story = {
  name: "Import: Review with warnings",
  render: () => (
    <Stage
      args={viewArgs({
        phase: "review",
        preview: { ...AGENT_IMPORT_PREVIEW, warnings: AGENT_IMPORT_WARNINGS },
      })}
    />
  ),
};

export const Importing: Story = {
  name: "Import: Importing",
  render: () => <Stage args={viewArgs({ phase: "importing", preview: AGENT_IMPORT_PREVIEW })} />,
};

export const Done: Story = {
  name: "Import: Done",
  render: () => <Stage args={viewArgs({ phase: "done", result: RESULT })} />,
};

export const PartlyDone: Story = {
  name: "Import: Some agents did not import",
  render: () => (
    <Stage
      args={viewArgs({
        phase: "done",
        result: {
          agents: STORY_AGENT_SUMMARIES.slice(0, 1),
          skipped: [{ key: "inbox", name: "Inbox Triage", reason: "SKILL.md must begin with YAML frontmatter." }],
          channels: [],
          skippedChannels: [{ key: "desk", name: "Front desk", reason: "None of its agents were imported." }],
          warnings: ["Research: routine “Hourly price check” is skipped. The schedule runs too often."],
        },
      })}
    />
  ),
};

export const ReviewNarrow: Story = {
  name: "Import: Narrow",
  render: () => <Stage args={viewArgs({ phase: "review", preview: AGENT_IMPORT_PREVIEW })} narrow />,
};

// The same sections and icons as the real ServerSettingsModal for this computer.
const SERVER_SETTINGS_NAV = [
  { value: "general", label: "General", icon: Settings },
  { value: "members", label: "Members", icon: UsersRound },
  { value: "desktop", label: "Remote desktop", icon: Monitor },
  { value: "mcp", label: "MCP", icon: Blocks },
  { value: "storage", label: "Storage", icon: HardDrive },
  { value: "import", label: "Import", icon: Download },
] as const;

function ServerSettingsStage(props: { children: JSX.Element }) {
  const [tab, setTab] = createSignal("import");
  return (
    <SettingsPageStory title="Server settings">
      {(page) => (
        <Tabs.Root value={tab()} onChange={setTab} orientation="vertical" class="settings-modal-tabs-root">
          <SettingsDialogShell
            class="server-settings-modal-shell"
            open
            page={page()}
            title="Import"
            description="Move your agents from Grok Bot or Hermes Agent to this computer."
            contentKey={tab()}
            sidebar={
              <Tabs.List class="settings-modal-nav" aria-label="Server settings sections">
                {SERVER_SETTINGS_NAV.map((item) => {
                  const NavIcon = item.icon;
                  return (
                    <Tabs.Trigger class="settings-modal-nav-item" value={item.value}>
                      <NavIcon aria-hidden="true" />
                      <span>{item.label}</span>
                    </Tabs.Trigger>
                  );
                })}
              </Tabs.List>
            }
          >
            <Tabs.Content value="import" class="settings-modal-tab-panel server-settings-panel" data-tab="import">
              {props.children}
            </Tabs.Content>
          </SettingsDialogShell>
        </Tabs.Root>
      )}
    </SettingsPageStory>
  );
}

export const InServerSettings: Story = {
  name: "Import: Server settings",
  render: () => (
    <ServerSettingsStage>
      <AgentImportView {...viewArgs()} />
    </ServerSettingsStage>
  ),
};

export const ReviewInServerSettings: Story = {
  name: "Import: Review in Server settings",
  render: () => (
    <ServerSettingsStage>
      <AgentImportView {...viewArgs({ phase: "review", preview: AGENT_IMPORT_PREVIEW })} />
    </ServerSettingsStage>
  ),
};

type HermesArgs = Parameters<typeof HermesImportView>[0];

const hermesArgs = (overrides: Partial<HermesArgs> = {}): HermesArgs => ({
  phase: "review",
  preview: HERMES_IMPORT_PREVIEW,
  result: null,
  onBack: fn(),
  onChooseFolder: fn(),
  onImport: fn(),
  onDone: fn(),
  onOpenAgent: fn(),
  ...overrides,
});

/** The first screen: Hermes, Grok Bot, or another OpenBot computer. */
export const Sources: Story = {
  name: "Import: Sources",
  render: () => (
    <ServerSettingsStage>
      <AgentImportSources transfer onHermes={fn()} onGrok={fn()} onTransfer={fn()} />
    </ServerSettingsStage>
  ),
};

/** A joined server the user does not administer: no Transfer. */
export const SourcesJoinedServer: Story = {
  name: "Import: Sources on a joined server",
  render: () => (
    <Stage>
      <AgentImportSources transfer={false} onHermes={fn()} onGrok={fn()} onTransfer={fn()} />
    </Stage>
  ),
};

const hermesGuideArgs = (overrides: Partial<ViewArgs> = {}): ViewArgs =>
  viewArgs({
    source: "hermes-agent",
    setup: "folder",
    exportSkill: HERMES_EXPORT_SKILL,
    onReadFolder: fn(),
    ...overrides,
  });

/** Hermes on this computer: read its folder, install the export skill with a command, or add it by hand. */
export const HermesSteps: Story = {
  name: "Hermes: Steps",
  render: () => {
    const [setup, setSetup] = createSignal<ViewArgs["setup"]>("folder");
    return (
      <ServerSettingsStage>
        <AgentImportView {...hermesGuideArgs({ setup: setup(), onSetupChange: setSetup })} />
      </ServerSettingsStage>
    );
  },
};

export const HermesInstallCommand: Story = {
  name: "Hermes: Install with a command",
  render: () => (
    <ServerSettingsStage>
      <AgentImportView {...hermesGuideArgs({ setup: "command" })} />
    </ServerSettingsStage>
  ),
};

export const HermesSkillYourself: Story = {
  name: "Hermes: Set it up yourself",
  render: () => (
    <ServerSettingsStage>
      <AgentImportView {...hermesGuideArgs({ setup: "skill" })} />
    </ServerSettingsStage>
  ),
};

/** A joined server cannot read this computer's folder, so Hermes offers the export only. */
export const HermesStepsJoinedServer: Story = {
  name: "Hermes: Steps on a joined server",
  render: () => (
    <Stage>
      <AgentImportView {...hermesGuideArgs({ setup: "command", onReadFolder: undefined })} />
    </Stage>
  ),
};

/** An export the skill made in Hermes: the same review as a Grok Bot export. */
export const HermesExportReview: Story = {
  name: "Hermes: Export review",
  render: () => (
    <ServerSettingsStage>
      <AgentImportView
        {...hermesGuideArgs({
          phase: "review",
          preview: {
            ...AGENT_IMPORT_PREVIEW,
            sourceApp: "hermes-agent",
            exportedAt: "2026-10-21T10:00:00.000Z",
            agents: AGENT_IMPORT_PREVIEW.agents.map((agent) => ({
              ...agent,
              avatarUrl: null,
              fileCount: 0,
              fileBytes: 0,
            })),
            channels: [],
          },
        })}
      />
    </ServerSettingsStage>
  ),
};

/** Every item of every profile, with what needs approval and what stays in Hermes. */
export const HermesReview: Story = {
  name: "Hermes: Review",
  render: () => (
    <ServerSettingsStage>
      <HermesImportView {...hermesArgs()} />
    </ServerSettingsStage>
  ),
};

/** A second import: the profile imported before updates its agent, or is left as it is. */
export const HermesSecondImport: Story = {
  name: "Hermes: Second import",
  render: () => (
    <ServerSettingsStage>
      <HermesImportView
        {...hermesArgs({
          preview: {
            ...HERMES_IMPORT_PREVIEW,
            profiles: HERMES_IMPORT_PREVIEW.profiles.map((profile) =>
              profile.key === "default" ? { ...profile, agent: { id: "agent-hermes", name: "Hermes" } } : profile,
            ),
          },
        })}
      />
    </ServerSettingsStage>
  ),
};

export const HermesNotFound: Story = {
  name: "Hermes: No profiles found",
  render: () => (
    <ServerSettingsStage>
      <HermesImportView {...hermesArgs({ phase: "missing", preview: null })} />
    </ServerSettingsStage>
  ),
};

export const HermesDone: Story = {
  name: "Hermes: Done",
  render: () => (
    <ServerSettingsStage>
      <HermesImportView
        {...hermesArgs({
          phase: "done",
          preview: null,
          updated: new Set(RESULT.agents.slice(0, 1).map((agent) => agent.id)),
          result: {
            ...RESULT,
            channels: [],
            warnings: [
              "Research desk: SOUL.md is longer than 2000 characters, so the instructions keep its start. The full file is in imported/hermes/SOUL.md.",
              "filesystem: the MCP server is added turned off. Check its command, enter its values and full address again, and turn it on in MCP settings.",
            ],
          },
        })}
      />
    </ServerSettingsStage>
  ),
};

/** The whole way through on this computer: choose Hermes, read its folder, review, import. */
export const HermesFlow: Story = {
  name: "Hermes: Server settings",
  render: () => {
    const [screen, setScreen] = createSignal<"sources" | "guide" | "hermes">("sources");
    const [setup, setSetup] = createSignal<ViewArgs["setup"]>("folder");
    const [phase, setPhase] = createSignal<HermesImportPhase>("review");
    return (
      <ServerSettingsStage>
        <Switch>
          <Match when={screen() === "sources"}>
            <AgentImportSources transfer onHermes={() => setScreen("guide")} onGrok={fn()} onTransfer={fn()} />
          </Match>
          <Match when={screen() === "guide"}>
            <AgentImportView
              {...hermesGuideArgs({
                setup: setup(),
                onSetupChange: setSetup,
                onReadFolder: () => {
                  setPhase("review");
                  setScreen("hermes");
                },
              })}
            />
          </Match>
          <Match when={screen() === "hermes"}>
            <HermesImportView
              {...hermesArgs({
                phase: phase(),
                result: phase() === "done" ? RESULT : null,
                onBack: () => setScreen("guide"),
                onImport: () => setPhase("done"),
                onDone: () => setScreen("sources"),
              })}
            />
          </Match>
        </Switch>
      </ServerSettingsStage>
    );
  },
};
