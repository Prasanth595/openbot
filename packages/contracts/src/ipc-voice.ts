import { isOneOf } from "./runtime-values";

export const VOICE_AUDIO_LIMITS = {
  sampleRate: 16_000,
  channels: 1,
  bitsPerSample: 16,
  maximumSeconds: 120,
  maximumWavBytes: 3_840_044,
} as const;

export interface VoiceTranscriptionInput {
  audio: Uint8Array;
}

export interface VoiceTranscriptionResult {
  text: string;
}

/** The local speech recognition models. Saved in `voice-preference.json`; never rename one. */
export const VOICE_MODEL_IDS = ["parakeet-tdt-0.6b-v3", "whisper-turbo"] as const;
export type VoiceModelId = (typeof VOICE_MODEL_IDS)[number];
export const DEFAULT_VOICE_MODEL_ID: VoiceModelId = "parakeet-tdt-0.6b-v3";

export interface VoiceModelInfo {
  id: VoiceModelId;
  /** The product name. It is not translated. */
  name: string;
  /** The download size of all files. */
  bytes: number;
  /** True when the model takes a fixed language. Parakeet always finds the language itself. */
  supportsLanguage: boolean;
  /**
   * True when the composer shows text while you speak. Whisper reads 30 s for each pass, so it
   * transcribes only after Stop.
   */
  livePreview: boolean;
}

export const VOICE_MODELS: readonly VoiceModelInfo[] = [
  {
    id: "parakeet-tdt-0.6b-v3",
    name: "Parakeet TDT 0.6B v3",
    bytes: 670_478_772,
    supportsLanguage: false,
    livePreview: true,
  },
  {
    id: "whisper-turbo",
    name: "Whisper large-v3 turbo",
    bytes: 1_036_613_791,
    supportsLanguage: true,
    livePreview: false,
  },
];

/** The model finds the spoken language itself. */
export const AUTOMATIC_VOICE_LANGUAGE = "automatic";

/**
 * The Whisper language codes that the settings offer. Each one has a `language.name.*` catalog
 * name; `jw` is Whisper's code for Javanese (`jv`). Automatic also finds the languages not listed.
 */
export const WHISPER_LANGUAGES = [
  "af",
  "am",
  "ar",
  "az",
  "be",
  "bg",
  "bn",
  "bs",
  "ca",
  "cs",
  "cy",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "eu",
  "fa",
  "fi",
  "fr",
  "gl",
  "gu",
  "he",
  "hi",
  "hr",
  "hu",
  "hy",
  "id",
  "is",
  "it",
  "ja",
  "jw",
  "ka",
  "kk",
  "km",
  "kn",
  "ko",
  "lo",
  "lt",
  "lv",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "ne",
  "nl",
  "no",
  "pa",
  "pl",
  "pt",
  "ro",
  "ru",
  "si",
  "sk",
  "sl",
  "sq",
  "sr",
  "su",
  "sv",
  "sw",
  "ta",
  "te",
  "th",
  "tr",
  "uk",
  "ur",
  "uz",
  "vi",
  "yue",
  "zh",
] as const;
export type WhisperLanguage = (typeof WHISPER_LANGUAGES)[number];
export type VoiceLanguage = typeof AUTOMATIC_VOICE_LANGUAGE | WhisperLanguage;

export interface VoiceSettings {
  modelId: VoiceModelId;
  /** Used only by a model that `supportsLanguage`. */
  language: VoiceLanguage;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  modelId: DEFAULT_VOICE_MODEL_ID,
  language: AUTOMATIC_VOICE_LANGUAGE,
};

export type VoiceModelPhase = "missing" | "downloading" | "ready" | "error";

export interface VoiceModelStatus {
  modelId: VoiceModelId;
  phase: VoiceModelPhase;
  progress: number | null;
  message: string | null;
}

export interface VoiceModelRequest {
  modelId: VoiceModelId;
}

export function isVoiceModelId(value: unknown): value is VoiceModelId {
  return isOneOf(VOICE_MODEL_IDS, value);
}

export function isVoiceLanguage(value: unknown): value is VoiceLanguage {
  return value === AUTOMATIC_VOICE_LANGUAGE || isOneOf(WHISPER_LANGUAGES, value);
}
