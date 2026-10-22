import {
  type AgentModelOption,
  type AgentProviderId,
  type AgentReasoningEffort,
  agentProviderName,
  type ForeignProviderId,
  type ProviderAccountStatus,
  providerDisplayName,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery } from "@tanstack/react-query";
import { Button, ListGroup, Typography } from "heroui-native";
import Brain from "lucide-react-native/icons/brain";
import Check from "lucide-react-native/icons/check";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Gauge from "lucide-react-native/icons/gauge";
import Plus from "lucide-react-native/icons/plus";
import { useState } from "react";
import { View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import {
  type MobileAgent,
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

export const EFFORT_LABELS = {
  low: "mobile.agent.runtime.effort.low",
  medium: "mobile.agent.runtime.effort.medium",
  high: "mobile.agent.runtime.effort.high",
  xhigh: "mobile.agent.runtime.effort.xhigh",
  max: "mobile.agent.runtime.effort.max",
} as const satisfies Record<AgentReasoningEffort, MobileTextKey>;

/**
 * A menu picker is as wide as the label it shows, and the row puts that label beside its title on
 * one line. A model name has no length the host promises to respect -- OpenCode states the vendor,
 * the model and the price tier in one string -- so an untruncated name pushed "Model" until it
 * wrapped mid-word. The cap is on the visible label only; the id that gets saved is untouched.
 */
const MAX_PICKER_LABEL = 28;
function pickerLabel(text: string): string {
  const characters = Array.from(text);
  return characters.length > MAX_PICKER_LABEL ? `${characters.slice(0, MAX_PICKER_LABEL).join("").trimEnd()}…` : text;
}

/**
 * The accounts of the host's providers, and the agents on an account after the first. Null for a
 * member, for a host without `provider-accounts-v1`, and until the host answers.
 */
export function useProviderAccounts(agent: MobileAgent, enabled: boolean) {
  const workspace = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const canManage = useMobileWorkspaceSelector((current) => current.canManageProviderAccounts(agent.serverId));
  // Under "agent-info", so the host's agent events refresh it with the other agent records.
  const queryKey = queryKeys.agentProviderAccounts(queryScope, agent.serverId, agent.id);
  const accounts = useQuery({
    queryKey,
    queryFn: () => workspace.loadProviderAccounts(agent.serverId),
    enabled: enabled && canManage,
    retry: false,
    // Another device can change the accounts at any time, so a reopened page reads the host again.
    staleTime: 0,
  });
  return { queryKey, accounts: canManage ? (accounts.data ?? null) : null };
}

export function AgentRuntimeFields({
  serverId,
  available,
  saving,
  provider,
  foreignProvider,
  model,
  reasoningEffort,
  hostDefault = false,
  appearance = "settings",
  title,
  accounts = [],
  accountId = "",
  onChange,
  onAccountChange,
}: {
  serverId: string;
  available: boolean;
  saving: boolean;
  provider?: AgentProviderId;
  /** The provider when this build does not know it. The choice shows it and stays disabled. */
  foreignProvider?: ForeignProviderId | undefined;
  model?: string;
  reasoningEffort?: AgentReasoningEffort;
  /**
   * A new agent: the provider list starts with the host's default, which sends no pair, so the host
   * keeps its saved provider choice. The model rows show after the user picks a provider.
   */
  hostDefault?: boolean;
  appearance?: "settings" | "brain";
  title?: string;
  /** The accounts of the provider. The choice shows only when there are two or more. */
  accounts?: readonly ProviderAccountStatus[];
  accountId?: string;
  onChange: (value: Pick<UpdateAgentInput, "provider" | "model" | "reasoningEffort">) => void;
  onAccountChange?: (accountId: string) => void;
}) {
  const { t } = useText();
  // The name of an account, as on desktop: the user's name for it, its email, or its place in the list.
  const accountName = (account: ProviderAccountStatus, index: number) =>
    account.label || account.email || t("mobile.agent.runtime.accountNumbered", { number: index + 1 });
  const workspace = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const { theme } = useUniwind();
  const accent = String(useCSSVariable("--openbot-accent-text"));
  const models = useQuery({
    queryKey: queryKeys.agentModels(queryScope, serverId),
    queryFn: () => workspace.loadAgentModels(serverId),
    enabled: available,
    retry: false,
  });
  const options = models.data?.filter((option) => option.provider === provider) ?? [];
  const selected = options.find((option) => option.id === model);
  const enabled = available && !saving && options.length > 0;
  const showsModel = foreignProvider === undefined && (!hostDefault || provider !== undefined);
  if (appearance === "brain" && foreignProvider === undefined) {
    return (
      <View className="gap-3">
        <BrainChoices
          models={models.data ?? []}
          provider={provider}
          model={model}
          reasoningEffort={reasoningEffort}
          disabled={!available || saving}
          onChange={onChange}
        />
        {onAccountChange && accounts.length > 1 ? (
          <SettingsSection title={t("mobile.agent.runtime.account")}>
            {accounts.map((account, index) => (
              <SettingsRow
                key={account.id}
                checked={account.id === accountId}
                disabled={!available || saving}
                disclosure={false}
                trailing={account.id === accountId ? <Check size={18} color={accent} /> : undefined}
                onPress={() => onAccountChange(account.id)}
              >
                <Typography.Paragraph>{accountName(account, index)}</Typography.Paragraph>
              </SettingsRow>
            ))}
          </SettingsSection>
        ) : null}
        {models.isError ? (
          <Button variant="ghost" onPress={() => void models.refetch()}>
            <Button.Label>{t("mobile.agent.runtime.retryModels")}</Button.Label>
          </Button>
        ) : available && models.isPending ? (
          <Typography.Paragraph className="text-grouped-secondary">
            {t("mobile.agent.runtime.loadingModels")}
          </Typography.Paragraph>
        ) : available && !models.data?.length ? (
          <Typography.Paragraph className="text-grouped-secondary">
            {t("mobile.agent.runtime.noModels")}
          </Typography.Paragraph>
        ) : null}
      </View>
    );
  }
  return (
    <>
      <SettingsSection title={title}>
        <SettingsRow
          trailing={
            <SettingsPicker<string>
              value={provider ?? ""}
              options={
                foreignProvider !== undefined
                  ? [
                      {
                        value: "",
                        label: t("mobile.agent.runtime.updateToUse", { name: providerDisplayName(foreignProvider) }),
                      },
                    ]
                  : [
                      ...(hostDefault ? [{ value: "", label: t("mobile.agent.runtime.hostDefault") }] : []),
                      ...(!models.data?.some((option) => option.provider === provider) && showsModel
                        ? [
                            {
                              value: provider ?? "",
                              label: provider ? agentProviderName(provider) : t("mobile.agent.runtime.unavailable"),
                            },
                          ]
                        : []),
                      ...Array.from(new Set(models.data?.map((option) => option.provider))).map((value) => ({
                        value,
                        label: agentProviderName(value),
                      })),
                    ]
              }
              enabled={foreignProvider === undefined && available && !saving && Boolean(models.data?.length)}
              dark={theme === "dark"}
              label={t("mobile.agent.runtime.provider")}
              onChange={(value) => {
                if (hostDefault && value === "") {
                  onChange({ provider: undefined, model: undefined, reasoningEffort: undefined });
                  return;
                }
                const next = models.data?.find((option) => option.provider === value);
                if (next)
                  onChange({ provider: next.provider, model: next.id, reasoningEffort: next.defaultReasoningEffort });
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.agent.runtime.provider")}</Typography.Paragraph>
        </SettingsRow>
        {onAccountChange && accounts.length > 1 ? (
          <SettingsRow
            trailing={
              <SettingsPicker<string>
                value={accountId}
                options={[
                  ...(!accounts.some((account) => account.id === accountId)
                    ? [{ value: accountId, label: t("mobile.agent.runtime.unavailable") }]
                    : []),
                  ...accounts.map((account, index) => ({
                    value: account.id,
                    label: pickerLabel(accountName(account, index)),
                  })),
                ]}
                enabled={available && !saving}
                dark={theme === "dark"}
                label={t("mobile.agent.runtime.account")}
                onChange={onAccountChange}
              />
            }
          >
            <Typography.Paragraph>{t("mobile.agent.runtime.account")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {showsModel ? (
          <SettingsRow
            trailing={
              <SettingsPicker<string>
                value={model ?? ""}
                options={[
                  ...(!selected
                    ? [
                        {
                          value: model ?? "",
                          label: model ? pickerLabel(model) : t("mobile.agent.runtime.unavailable"),
                        },
                      ]
                    : []),
                  ...options.map((option) => ({ value: option.id, label: pickerLabel(option.name) })),
                ]}
                enabled={enabled}
                dark={theme === "dark"}
                label={t("mobile.agent.runtime.model")}
                onChange={(id) => {
                  const next = options.find((option) => option.id === id);
                  if (!next) return;
                  onChange({
                    model: next.id,
                    reasoningEffort:
                      reasoningEffort && next.supportedReasoningEfforts.includes(reasoningEffort)
                        ? reasoningEffort
                        : next.defaultReasoningEffort,
                  });
                }}
              />
            }
          >
            <Typography.Paragraph>{t("mobile.agent.runtime.model")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {showsModel ? (
          <SettingsRow
            trailing={
              <SettingsPicker<string>
                value={reasoningEffort ?? ""}
                options={[
                  ...(!reasoningEffort || !selected?.supportedReasoningEfforts.includes(reasoningEffort)
                    ? [
                        {
                          value: reasoningEffort ?? "",
                          label: reasoningEffort ?? t("mobile.agent.runtime.unavailable"),
                        },
                      ]
                    : []),
                  ...(selected?.supportedReasoningEfforts.map((effort) => ({
                    value: effort,
                    label: t(EFFORT_LABELS[effort]),
                  })) ?? []),
                ]}
                enabled={enabled && Boolean(selected?.supportedReasoningEfforts.length)}
                dark={theme === "dark"}
                label={t("mobile.agent.runtime.reasoning")}
                onChange={(effort) => {
                  const next = selected?.supportedReasoningEfforts.find((option) => option === effort);
                  if (next) onChange({ reasoningEffort: next });
                }}
              />
            }
          >
            <Typography.Paragraph>{t("mobile.agent.runtime.reasoning")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {models.isError ? (
        <Button variant="ghost" onPress={() => void models.refetch()}>
          <Button.Label>{t("mobile.agent.runtime.retryModels")}</Button.Label>
        </Button>
      ) : available && models.isPending ? (
        <Typography.Paragraph>{t("mobile.agent.runtime.loadingModels")}</Typography.Paragraph>
      ) : available && showsModel && !options.length ? (
        <Typography.Paragraph>{t("mobile.agent.runtime.noModels")}</Typography.Paragraph>
      ) : null}
    </>
  );
}

function BrainChoices({
  models,
  provider,
  model,
  reasoningEffort,
  disabled,
  onChange,
}: {
  models: readonly AgentModelOption[];
  provider?: AgentProviderId;
  model?: string;
  reasoningEffort?: AgentReasoningEffort;
  disabled: boolean;
  onChange: (value: Pick<UpdateAgentInput, "provider" | "model" | "reasoningEffort">) => void;
}) {
  const { t } = useText();
  const foreground = String(useCSSVariable("--openbot-text-secondary"));
  const accent = String(useCSSVariable("--openbot-accent-text"));
  const [expanded, setExpanded] = useState(false);
  const selected = models.find((option) => option.provider === provider && option.id === model);
  const supportedEfforts =
    selected?.reasoningEffortConfigurable === false ? [] : (selected?.supportedReasoningEfforts ?? []);
  const efforts = [
    ...supportedEfforts.filter((effort) => effort === reasoningEffort),
    ...supportedEfforts.filter((effort) => effort !== reasoningEffort),
  ];
  const allChoices = [
    ...(!selected && model ? [{ provider, id: model, name: model, option: undefined }] : []),
    ...models.map((option) => ({ provider: option.provider, id: option.id, name: option.name, option })),
  ];
  const currentChoice = allChoices.find((option) => option.provider === provider && option.id === model);
  const otherChoices = allChoices.filter((option) => option !== currentChoice);
  const choices = [...(currentChoice ? [currentChoice] : []), ...(expanded ? otherChoices : [])];
  return (
    <>
      <Typography.Paragraph
        className="px-1 text-grouped-secondary"
        style={[typeScale.teamMeta, { textTransform: "uppercase" }]}
      >
        {t("mobile.agent.runtime.model")}
      </Typography.Paragraph>
      <ListGroup
        variant="secondary"
        className="overflow-hidden border border-grouped-border bg-grouped p-0 shadow-none"
        style={{ borderRadius: 14 }}
      >
        {choices.map((option, index) => {
          const checked = option.provider === provider && option.id === model;
          return (
            <View key={`${option.provider}:${option.id}`}>
              {index > 0 ? <View className="h-px bg-grouped-border" /> : null}
              <ListGroup.Item
                accessibilityRole="radio"
                accessibilityState={{ checked, disabled: disabled || !option.option }}
                disabled={disabled || !option.option}
                className="min-h-16 flex-row items-center gap-3 py-2 pr-1 pl-4"
                onPress={() => {
                  const next = option.option;
                  if (!next) return;
                  void haptics.impact("soft");
                  setExpanded(false);
                  onChange({
                    provider: next.provider,
                    model: next.id,
                    reasoningEffort:
                      next.provider === provider &&
                      reasoningEffort &&
                      next.supportedReasoningEfforts.includes(reasoningEffort)
                        ? reasoningEffort
                        : next.defaultReasoningEffort,
                  });
                }}
                style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}
              >
                <Brain size={18} color={foreground} />
                <View className="min-w-0 flex-1 gap-0.5">
                  <Typography.Paragraph weight="medium" style={{ fontFamily: "Inter", fontSize: 16, lineHeight: 21 }}>
                    {option.name}
                  </Typography.Paragraph>
                  <Typography.Paragraph
                    className="text-grouped-secondary"
                    style={{ fontFamily: "Inter", fontSize: 13, lineHeight: 17 }}
                  >
                    {option.provider ? agentProviderName(option.provider) : t("mobile.agent.runtime.unavailable")}
                  </Typography.Paragraph>
                </View>
                <View className="h-11 w-10 items-center justify-center">
                  {checked ? <Check size={18} color={accent} /> : null}
                </View>
              </ListGroup.Item>
            </View>
          );
        })}
        {otherChoices.length ? (
          <>
            {choices.length ? <View className="h-px bg-grouped-border" /> : null}
            <ListGroup.Item
              accessibilityRole="button"
              accessibilityState={{ expanded, disabled }}
              disabled={disabled}
              onPress={() => {
                void haptics.impact("soft");
                setExpanded((current) => !current);
              }}
              className="min-h-13 flex-row items-center gap-3 px-4 py-2"
              style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}
            >
              {expanded ? <ChevronUp size={18} color={foreground} /> : <Plus size={18} color={foreground} />}
              <Typography.Paragraph
                weight="medium"
                className="min-w-0 flex-1 text-grouped-secondary"
                style={{ fontFamily: "Inter", fontSize: 16, lineHeight: 21 }}
              >
                {t(expanded ? "mobile.agent.runtime.showFewerModels" : "mobile.agent.runtime.moreModels")}
              </Typography.Paragraph>
            </ListGroup.Item>
          </>
        ) : null}
      </ListGroup>
      {efforts.length ? (
        <>
          <Typography.Paragraph
            className="px-1 text-grouped-secondary"
            style={[typeScale.teamMeta, { textTransform: "uppercase" }]}
          >
            {t("mobile.agent.runtime.reasoning")}
          </Typography.Paragraph>
          <ListGroup
            variant="secondary"
            className="overflow-hidden border border-grouped-border bg-grouped p-0 shadow-none"
            style={{ borderRadius: 14 }}
          >
            {efforts.map((effort, index) => (
              <View key={effort}>
                {index > 0 ? <View className="h-px bg-grouped-border" /> : null}
                <ListGroup.Item
                  accessibilityRole="radio"
                  accessibilityState={{ checked: reasoningEffort === effort, disabled }}
                  disabled={disabled}
                  onPress={() => {
                    void haptics.impact("soft");
                    onChange({ reasoningEffort: effort });
                  }}
                  className="min-h-13 flex-row items-center gap-3 py-1 pr-1 pl-4"
                  style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}
                >
                  <Gauge size={18} color={foreground} />
                  <Typography.Paragraph
                    weight="medium"
                    className="min-w-0 flex-1"
                    style={{ fontFamily: "Inter", fontSize: 16, lineHeight: 21 }}
                  >
                    {t(EFFORT_LABELS[effort])}
                  </Typography.Paragraph>
                  <View className="h-11 w-10 items-center justify-center">
                    {reasoningEffort === effort ? <Check size={18} color={accent} /> : null}
                  </View>
                </ListGroup.Item>
              </View>
            ))}
          </ListGroup>
        </>
      ) : null}
    </>
  );
}
