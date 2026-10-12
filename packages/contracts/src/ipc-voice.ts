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
export const LOCAL_VOICE_MODEL_IDS = ["parakeet-tdt-0.6b-v3", "whisper-turbo"] as const;
export type LocalVoiceModelId = (typeof LOCAL_VOICE_MODEL_IDS)[number];

/**
 * ElevenLabs Scribe v2 Realtime. Audio streams to ElevenLabs with the user's own API key, so it is
 * never the default. Saved in `voice-preference.json`; never rename it.
 */
export const ELEVENLABS_VOICE_MODEL_ID = "elevenlabs-scribe-v2-realtime";

/** Every dictation model, local ones first. */
export const VOICE_MODEL_IDS = [...LOCAL_VOICE_MODEL_IDS, ELEVENLABS_VOICE_MODEL_ID] as const;
export type VoiceModelId = (typeof VOICE_MODEL_IDS)[number];
export const DEFAULT_VOICE_MODEL_ID: VoiceModelId = "parakeet-tdt-0.6b-v3";

interface VoiceModelCapabilities {
  /** The product name. It is not translated. */
  name: string;
  /** True when the model takes a fixed language. Parakeet always finds the language itself. */
  supportsLanguage: boolean;
  /**
   * True when the composer shows text while you speak. Whisper reads 30 s for each pass, so it
   * transcribes only after Stop.
   */
  livePreview: boolean;
}

/** A model that runs on this computer after a download. */
export interface LocalVoiceModelInfo extends VoiceModelCapabilities {
  kind: "local";
  id: LocalVoiceModelId;
  /** The download size of all files. */
  bytes: number;
}

/** A model that runs at a provider. It is ready when its API key is saved. */
export interface CloudVoiceModelInfo extends VoiceModelCapabilities {
  kind: "cloud";
  id: typeof ELEVENLABS_VOICE_MODEL_ID;
}

export type VoiceModelInfo = LocalVoiceModelInfo | CloudVoiceModelInfo;

export const VOICE_MODELS: readonly VoiceModelInfo[] = [
  {
    kind: "local",
    id: "parakeet-tdt-0.6b-v3",
    name: "Parakeet TDT 0.6B v3",
    bytes: 670_478_772,
    supportsLanguage: false,
    livePreview: true,
  },
  {
    kind: "local",
    id: "whisper-turbo",
    name: "Whisper large-v3 turbo",
    bytes: 1_036_613_791,
    supportsLanguage: true,
    livePreview: false,
  },
  {
    kind: "cloud",
    id: ELEVENLABS_VOICE_MODEL_ID,
    name: "ElevenLabs Scribe v2 Realtime",
    supportsLanguage: true,
    livePreview: true,
  },
];

/** The model finds the spoken language itself. */
export const AUTOMATIC_VOICE_LANGUAGE = "automatic";

/**
 * The Whisper language codes that the settings offer. Each one has a `language.name.*` catalog
 * name; `jw` is Whisper's code for Javanese (`jv`). Automatic also finds the languages not listed.
 * ElevenLabs takes the same ISO 639 codes, with `jv` for `jw`.
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

/** The ElevenLabs API key, or null to remove it. Main never sends a saved key back. */
export interface VoiceApiKeyInput {
  key: string | null;
}

/** The longest API key main accepts, as for provider keys. */
export const VOICE_API_KEY_MAX_LENGTH = 512;

/**
 * One streamed dictation. The renderer sends the recording in parts while the user speaks;
 * `streamId` keeps the parts and the text of one recording apart from a later one.
 */
export interface VoiceStream {
  streamId: string;
}

/**
 * New audio of a stream: little-endian 16-bit mono PCM at 16 kHz that follows the audio sent
 * before. At most `VOICE_STREAM_LIMITS.maximumChunkBytes` in one part.
 */
export interface VoiceStreamAudio extends VoiceStream {
  pcm: Uint8Array;
}

export const VOICE_STREAM_LIMITS = {
  /** 5 s of audio. The renderer sends about every 250 ms. */
  maximumChunkBytes: 160_000,
} as const;

/** The text of a stream so far: the final segments and the segment the user still speaks. */
export interface VoiceStreamTranscript extends VoiceStream {
  text: string;
}

export function isVoiceModelId(value: unknown): value is VoiceModelId {
  return isOneOf(VOICE_MODEL_IDS, value);
}

export function isLocalVoiceModelId(value: unknown): value is LocalVoiceModelId {
  return isOneOf(LOCAL_VOICE_MODEL_IDS, value);
}

export function isVoiceLanguage(value: unknown): value is VoiceLanguage {
  return value === AUTOMATIC_VOICE_LANGUAGE || isOneOf(WHISPER_LANGUAGES, value);
}
