import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Button, Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { useText } from "@/shared/lib/text";
import { ListingIcon } from "../components/marketplace-parts";
import { appListings } from "../model/marketplace-listings";
import { type PluginAuthValues, pluginConnectMethod, pluginKeyComplete } from "../model/plugin-connect";
import { usePluginConnect } from "../model/use-plugin-connect";

/**
 * The second page of an app's sheet: the key the app asks for, or its browser sign-in. The server
 * tests the key before it saves the app; a sign-in ends on the server, which keeps the grant.
 */
export function MarketplaceAppConnectScreen() {
  const { t } = useText();
  const { serverId, slug } = useLocalSearchParams<{ serverId: string; slug: string }>();
  const { session } = useMobileSession();
  const listing = session?.apiUrl ? appListings(session.apiUrl).find((item) => item.id === slug) : undefined;
  const plugin = listing?.kind === "app" ? listing.plugin : null;
  const app = plugin?.apps[0] ?? null;
  const canRelay = useMobileWorkspaceSelector((workspace) => workspace.canRelayMcpSignIn(serverId));
  const method = app ? pluginConnectMethod(app, canRelay) : null;
  const connect = usePluginConnect(serverId, app, method);
  const [values, setValues] = useState<PluginAuthValues>({});
  const [address, setAddress] = useState("");
  const phase = connect.state.phase;
  const working = phase === "working" || phase === "waiting";
  usePreventRemove(phase === "working", () => undefined);
  // Back to the listing, which now shows the app as connected, after the guard is released.
  useEffect(() => {
    if (phase === "done") router.back();
  }, [phase]);

  if (!listing || !method || (method.kind !== "key" && method.kind !== "link"))
    return (
      <SheetScrollView
        className="bg-sheet"
        contentContainerClassName="px-4 pt-5"
        contentInsetAdjustmentBehavior="automatic"
      >
        <SettingsNote>{t("mobile.marketplace.listing.notFound")}</SettingsNote>
      </SheetScrollView>
    );

  const ready = method.kind === "link" || pluginKeyComplete(method.flow.fields, values);
  const signingIn = connect.state.phase === "signIn" ? connect.state : null;

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-6 px-4 pb-safe-offset-5 pt-5"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: t("mobile.marketplace.app.connectTitle", { name: listing.name }),
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      <SheetSaveAction
        dirty={phase === "idle" || phase === "working"}
        canSave={ready}
        pending={phase === "working"}
        label={method.kind === "link" ? t("mobile.marketplace.app.signIn") : t("mobile.marketplace.app.connect")}
        pendingLabel={t("mobile.marketplace.app.connecting")}
        onSave={() => void connect.connect(values)}
      />
      <View className="flex-row items-center gap-3 px-1">
        <ListingIcon listing={listing} size={44} />
        <View className="min-w-0 flex-1">
          <Typography.Paragraph className="font-semibold">{method.flow.label}</Typography.Paragraph>
          <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
            {method.kind === "link" ? t("mobile.marketplace.app.signInIntro") : t("mobile.marketplace.app.keyIntro")}
          </Typography.Paragraph>
        </View>
      </View>
      {method.kind === "key" ? (
        <View className="gap-4">
          {method.flow.fields.map((field) => (
            <SheetFormField
              key={field.id}
              label={field.label}
              hint={field.hint}
              isRequired={!field.optional}
              placeholder={field.placeholder}
              value={values[field.id] ?? ""}
              editable={!working}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!field.url}
              inputMode={field.url ? "url" : "text"}
              onChangeText={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
            />
          ))}
          {method.flow.docsUrl ? (
            <SettingsSection>
              <SettingsRow onPress={() => void Linking.openURL(method.flow.docsUrl ?? "").catch(() => undefined)}>
                <Typography.Paragraph>{method.flow.docsLabel ?? t("mobile.marketplace.app.docs")}</Typography.Paragraph>
              </SettingsRow>
            </SettingsSection>
          ) : null}
        </View>
      ) : null}
      {phase === "waiting" ? <SettingsNote>{t("mobile.marketplace.app.waiting")}</SettingsNote> : null}
      {signingIn ? (
        <View className="gap-4">
          <SettingsSection
            footer={signingIn.paste ? t("mobile.marketplace.app.pasteHint") : t("mobile.marketplace.app.signInHint")}
          >
            <SettingsRow onPress={connect.reopen}>
              <Typography.Paragraph>{t("mobile.marketplace.app.openAgain")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
          {signingIn.paste ? (
            <>
              <SheetFormField
                label={t("mobile.marketplace.app.pasteLabel")}
                value={address}
                autoCapitalize="none"
                autoCorrect={false}
                inputMode="url"
                onChangeText={setAddress}
              />
              <Button
                className="bg-action"
                feedbackVariant="scale"
                isDisabled={!address.trim()}
                onPress={() => void connect.paste(address)}
              >
                <Button.Label className="text-action-foreground">
                  {t("mobile.marketplace.app.finishSignIn")}
                </Button.Label>
              </Button>
            </>
          ) : null}
        </View>
      ) : null}
      {connect.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-1 text-danger-text">
          {connect.error}
        </Typography.Paragraph>
      ) : null}
    </SheetScrollView>
  );
}
