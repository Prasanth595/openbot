import {
  AUTOMATIC_VOICE_LANGUAGE,
  ELEVENLABS_VOICE_MODEL_ID,
  VOICE_MODELS,
  type VoiceLanguage,
  type VoiceModelInfo,
  type VoiceModelStatus,
  WHISPER_LANGUAGES,
  type WhisperLanguage,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Badge,
  Button,
  Download,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Progress,
  RefreshCw,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createMemo, createStore, For, Show } from "solid-js";
import type { SettingsVoiceStore } from "./settings-voice-store";

const MODEL_DESCRIPTION = {
  "parakeet-tdt-0.6b-v3": "settings.voice.model.parakeet.description",
  "whisper-turbo": "settings.voice.model.whisper.description",
  [ELEVENLABS_VOICE_MODEL_ID]: "settings.voice.model.elevenlabs.description",
} as const satisfies Record<VoiceModelInfo["id"], AppTextKey>;

/** `jw` is Whisper's code for Javanese, whose catalog name is under `jv`. */
const LANGUAGE_NAME = {
  af: "language.name.af",
  am: "language.name.am",
  ar: "language.name.ar",
  az: "language.name.az",
  be: "language.name.be",
  bg: "language.name.bg",
  bn: "language.name.bn",
  bs: "language.name.bs",
  ca: "language.name.ca",
  cs: "language.name.cs",
  cy: "language.name.cy",
  da: "language.name.da",
  de: "language.name.de",
  el: "language.name.el",
  en: "language.name.en",
  es: "language.name.es",
  et: "language.name.et",
  eu: "language.name.eu",
  fa: "language.name.fa",
  fi: "language.name.fi",
  fr: "language.name.fr",
  gl: "language.name.gl",
  gu: "language.name.gu",
  he: "language.name.he",
  hi: "language.name.hi",
  hr: "language.name.hr",
  hu: "language.name.hu",
  hy: "language.name.hy",
  id: "language.name.id",
  is: "language.name.is",
  it: "language.name.it",
  ja: "language.name.ja",
  jw: "language.name.jv",
  ka: "language.name.ka",
  kk: "language.name.kk",
  km: "language.name.km",
  kn: "language.name.kn",
  ko: "language.name.ko",
  lo: "language.name.lo",
  lt: "language.name.lt",
  lv: "language.name.lv",
  mk: "language.name.mk",
  ml: "language.name.ml",
  mn: "language.name.mn",
  mr: "language.name.mr",
  ms: "language.name.ms",
  mt: "language.name.mt",
  my: "language.name.my",
  ne: "language.name.ne",
  nl: "language.name.nl",
  no: "language.name.no",
  pa: "language.name.pa",
  pl: "language.name.pl",
  pt: "language.name.pt",
  ro: "language.name.ro",
  ru: "language.name.ru",
  si: "language.name.si",
  sk: "language.name.sk",
  sl: "language.name.sl",
  sq: "language.name.sq",
  sr: "language.name.sr",
  su: "language.name.su",
  sv: "language.name.sv",
  sw: "language.name.sw",
  ta: "language.name.ta",
  te: "language.name.te",
  th: "language.name.th",
  tr: "language.name.tr",
  uk: "language.name.uk",
  ur: "language.name.ur",
  uz: "language.name.uz",
  vi: "language.name.vi",
  yue: "language.name.yue",
  zh: "language.name.zh",
} as const satisfies Record<WhisperLanguage, AppTextKey>;

/** The country of a language's flag: the likely region of the language, as `Intl.Locale` gives it. */
function flagFor(language: VoiceLanguage): string {
  if (language === AUTOMATIC_VOICE_LANGUAGE) return "🌐";
  try {
    const region = new Intl.Locale(language === "jw" ? "jv" : language).maximize().region;
    if (region && /^[A-Z]{2}$/u.test(region))
      return String.fromCodePoint(...[...region].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
  } catch {
    // A tag the engine does not know shows no flag.
  }
  return "🌐";
}

interface SettingsVoiceTabProps {
  store: SettingsVoiceStore;
  selectMount: HTMLElement | undefined;
}

export function SettingsVoiceTab(props: SettingsVoiceTabProps) {
  const { t, format, errorMessage } = useText();
  const settings = () => props.store.state.settings;
  const activeModel = () => VOICE_MODELS.find((model) => model.id === settings()?.modelId);
  const languageName = (language: VoiceLanguage) =>
    language === AUTOMATIC_VOICE_LANGUAGE ? t("settings.voice.language.automatic") : t(LANGUAGE_NAME[language]);
  const languageOptions = createMemo((): VoiceLanguage[] => {
    const collator = new Intl.Collator(format.locale);
    const names = new Map(WHISPER_LANGUAGES.map((language) => [language, languageName(language)]));
    const sorted = [...WHISPER_LANGUAGES].sort((left, right) =>
      collator.compare(names.get(left) ?? left, names.get(right) ?? right),
    );
    return [AUTOMATIC_VOICE_LANGUAGE, ...sorted];
  });

  // The key is never read back: main has no getter for it, and the field clears once it is saved.
  const [apiKey, setApiKey] = createStore({ draft: "", saving: false });
  const saveApiKey = async () => {
    const key = apiKey.draft.trim();
    if (!key || apiKey.saving) return;
    setApiKey((draft) => {
      draft.saving = true;
    });
    const saved = await props.store.saveApiKey(key);
    setApiKey((draft) => {
      draft.saving = false;
      if (saved) draft.draft = "";
    });
  };

  const statusText = (model: VoiceModelInfo, status: VoiceModelStatus | null) => {
    if (model.kind === "cloud")
      return status?.phase === "ready" ? t("settings.voice.model.keySaved") : t("settings.voice.model.keyMissing");
    if (status?.phase === "downloading")
      return t("settings.voice.model.downloading", {
        received: format.fileSize(Math.round((model.bytes * (status.progress ?? 0)) / 100)),
        total: format.fileSize(model.bytes),
      });
    if (status?.phase === "error") return errorMessage(status.message, t("settings.voice.model.failed"));
    return t("settings.voice.model.size", { size: format.fileSize(model.bytes) });
  };

  const LanguageLabel = (labelProps: { language: VoiceLanguage | undefined }) => (
    <Show when={labelProps.language}>
      {(language) => (
        <>
          <span aria-hidden="true">{flagFor(language())}</span> {languageName(language())}
        </>
      )}
    </Show>
  );

  return (
    <>
      <SettingsSection title={t("settings.voice.models.title")}>
        <ItemGroup class="settings-modal-card">
          <For each={VOICE_MODELS}>
            {(model) => {
              const status = () => props.store.state.statuses[model.id];
              const phase = () => status()?.phase;
              const inUse = () => settings()?.modelId === model.id;
              return (
                <Item class="settings-modal-row">
                  <ItemContent>
                    <ItemTitle>{model.name}</ItemTitle>
                    <ItemDescription>{t(MODEL_DESCRIPTION[model.id])}</ItemDescription>
                    <ItemDescription aria-live="polite">{statusText(model, status())}</ItemDescription>
                    <Show when={phase() === "downloading"}>
                      <Progress
                        value={status()?.progress ?? 0}
                        aria-label={t("settings.voice.model.progressLabel", { name: model.name })}
                      />
                    </Show>
                    <Show when={model.kind === "cloud" && phase() === "missing"}>
                      <div class="settings-voice-key">
                        <Input
                          type="password"
                          size="sm"
                          autocomplete="off"
                          spellcheck={false}
                          aria-label={t("settings.voice.apiKey.label")}
                          placeholder={t("settings.voice.apiKey.placeholder")}
                          value={apiKey.draft}
                          disabled={apiKey.saving}
                          onValueChange={(value) =>
                            setApiKey((draft) => {
                              draft.draft = value;
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void saveApiKey();
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          disabled={!apiKey.draft.trim() || apiKey.saving}
                          onClick={() => void saveApiKey()}
                        >
                          {t("settings.voice.apiKey.save")}
                        </Button>
                      </div>
                    </Show>
                  </ItemContent>
                  <ItemActions>
                    {/* The selected model is in use before its download too: dictation downloads it. */}
                    <Show when={inUse()}>
                      <Badge variant="secondary">{t("settings.voice.model.inUse")}</Badge>
                    </Show>
                    <Show when={model.kind === "cloud" && phase() === "ready"}>
                      <Button variant="ghost" size="sm" type="button" onClick={() => void props.store.removeApiKey()}>
                        {t("settings.voice.apiKey.remove")}
                      </Button>
                    </Show>
                    <Show when={model.kind === "local" && phase() === "missing"}>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        aria-label={t("settings.voice.model.downloadLabel", { name: model.name })}
                        onClick={() => props.store.download(model.id)}
                      >
                        <Download size={14} aria-hidden="true" />
                        {t("common.download")}
                      </Button>
                    </Show>
                    <Show when={phase() === "downloading"}>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        aria-label={t("settings.voice.model.cancelLabel", { name: model.name })}
                        onClick={() => props.store.cancel(model.id)}
                      >
                        {t("common.cancel")}
                      </Button>
                    </Show>
                    <Show when={phase() === "error"}>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        aria-label={t("settings.voice.model.retryLabel", { name: model.name })}
                        onClick={() => props.store.download(model.id)}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                        {t("common.tryAgain")}
                      </Button>
                    </Show>
                    <Show when={phase() === "ready" && settings() && !inUse()}>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        aria-label={t("settings.voice.model.useLabel", { name: model.name })}
                        onClick={() => props.store.useModel(model.id)}
                      >
                        {t("settings.voice.model.use")}
                      </Button>
                    </Show>
                  </ItemActions>
                </Item>
              );
            }}
          </For>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={t("settings.voice.language.section")}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("settings.voice.language.title")}</ItemTitle>
              <ItemDescription>
                {activeModel()?.supportsLanguage === false
                  ? t("settings.voice.language.modelDetects")
                  : t("settings.voice.language.description")}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select<VoiceLanguage>
                class="settings-modal-select"
                options={languageOptions()}
                value={settings()?.language ?? null}
                onChange={(next) => next && props.store.setLanguage(next)}
                disabled={!settings() || activeModel()?.supportsLanguage === false}
                placement="bottom-end"
                itemComponent={(selectProps) => (
                  <SelectItem item={selectProps.item}>
                    <LanguageLabel language={selectProps.item.rawValue} />
                  </SelectItem>
                )}
              >
                <SelectTrigger size="sm" aria-label={t("settings.voice.language.title")}>
                  <SelectValue<VoiceLanguage>>
                    {(state) => <LanguageLabel language={state.selectedOption()} />}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent mount={props.selectMount} />
              </Select>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>
    </>
  );
}
