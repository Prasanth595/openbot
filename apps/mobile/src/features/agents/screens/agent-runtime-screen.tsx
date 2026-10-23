import { DEFAULT_PROVIDER_ACCOUNT_ID, type HostProviderAccounts, type UpdateAgentInput } from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useRef, useState } from "react";
import { Alert } from "react-native";
import { AgentRuntimeFields, useProviderAccounts } from "@/features/agents/components/agent-runtime-fields";
import { useAgentAccessLevel } from "@/features/servers/model/use-server-roles";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

type RuntimeEdits = Pick<UpdateAgentInput, "provider" | "model" | "reasoningEffort">;

export function AgentRuntimeScreen({ nested = false }: { nested?: boolean }) {
  const { t } = useText();
  const { agentId, serverId } = useLocalSearchParams<{ agentId: string; serverId?: string }>();
  const workspace = useMobileWorkspace();
  const [hostId] = useState(serverId ?? workspace.activeServer.id);
  const agent = workspace.agents.find((candidate) => candidate.id === agentId && candidate.serverId === hostId);
  const host = workspace.servers.find((candidate) => candidate.id === hostId);
  const access = useAgentAccessLevel(hostId, agentId);
  const lastAgent = useRef(agent);
  if (agent) lastAgent.current = agent;
  const displayed = agent ?? lastAgent.current;
  return (
    <>
      <Stack.Screen
        options={{
          title: t("mobile.agent.groups.brain"),
          headerShown: true,
          ...(nested ? { headerBackVisible: true } : {}),
        }}
      />
      {displayed ? (
        <AgentRuntimeForm agent={displayed} available={Boolean(agent && showsOnline(host) && access === "manage")} />
      ) : (
        <SheetScrollView contentContainerClassName="p-5">
          <Typography.Paragraph>
            {t(host?.initialConnectionPending ? "mobile.agent.edit.loading" : "mobile.agent.edit.gone")}
          </Typography.Paragraph>
        </SheetScrollView>
      )}
    </>
  );
}

function AgentRuntimeForm({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t, errorMessage } = useText();
  const { updateAgent, setAgentProviderAccount } = useMobileWorkspace();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { queryKey: accountsKey, accounts: hostAccounts } = useProviderAccounts(agent, available);
  const [edits, setEdits] = useState<RuntimeEdits>({});
  const [account, setAccount] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const writable = useRef(available);
  writable.current = available;
  const allowClose = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const provider = edits.provider ?? agent.provider;
  const savedAccount =
    provider === agent.provider
      ? (hostAccounts?.agents.find((entry) => entry.agentId === agent.id)?.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID)
      : DEFAULT_PROVIDER_ACCOUNT_ID;
  const accountChanged = account !== undefined && account !== savedAccount;
  const dirty =
    accountChanged ||
    (edits.provider !== undefined && edits.provider !== agent.provider) ||
    (edits.model !== undefined && edits.model !== agent.model) ||
    (edits.reasoningEffort !== undefined && edits.reasoningEffort !== agent.reasoningEffort);

  usePreventRemove(dirty || saving, ({ data }) => {
    if (allowClose.current) {
      navigation.dispatch(data.action);
      return;
    }
    if (pending.current) return;
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  async function submit() {
    if (pending.current || (dirty && !writable.current)) return;
    if (!dirty) {
      router.back();
      return;
    }
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      if (Object.keys(edits).length) await updateAgent({ agentId: agent.id, ...edits }, agent.serverId);
      setEdits({});
      if (accountChanged || (edits.provider !== undefined && edits.provider !== agent.provider)) {
        const accountId = account === undefined || account === DEFAULT_PROVIDER_ACCOUNT_ID ? null : account;
        if (accountChanged) {
          if (!writable.current) return;
          await setAgentProviderAccount({ agentId: agent.id, accountId }, agent.serverId);
        }
        setAccount(undefined);
        queryClient.setQueryData<HostProviderAccounts | null>(accountsKey, (current) =>
          current
            ? {
                ...current,
                agents: [
                  ...current.agents.filter((entry) => entry.agentId !== agent.id),
                  ...(accountId ? [{ agentId: agent.id, accountId }] : []),
                ],
              }
            : current,
        );
      }
      void haptics.notification("success");
      allowClose.current = true;
      router.back();
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.agent.edit.failed")));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <SheetSaveAction dirty={dirty} canSave={available} pending={saving} onSave={() => void submit()} />
      <SheetScrollView
        contentContainerClassName="gap-3 px-5 pt-2 pb-safe-offset-5"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        <AgentRuntimeFields
          appearance="brain"
          serverId={agent.serverId}
          available={available}
          saving={saving}
          provider={provider}
          foreignProvider={edits.provider === undefined ? agent.foreignProvider : undefined}
          model={edits.model ?? agent.model}
          reasoningEffort={edits.reasoningEffort ?? agent.reasoningEffort}
          accounts={hostAccounts?.providers.find((entry) => entry.provider === provider)?.accounts ?? []}
          accountId={account ?? savedAccount}
          onChange={(value) => {
            setEdits((current) => ({ ...current, ...value }));
            if (value.provider !== undefined && value.provider !== provider) setAccount(undefined);
            setError(null);
          }}
          onAccountChange={(value) => {
            setAccount(value);
            setError(null);
          }}
        />
        {!available ? <Typography.Paragraph>{t("mobile.agent.edit.unavailable")}</Typography.Paragraph> : null}
        {error ? (
          <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
            {error}
          </Typography.Paragraph>
        ) : null}
      </SheetScrollView>
    </>
  );
}
