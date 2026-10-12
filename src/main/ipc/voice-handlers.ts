// The local speech recognition models (Parakeet, Whisper turbo), their settings, and dictation.

import type { VoiceModelStatus, VoiceSettings, VoiceTranscriptionResult } from "@openbot/contracts/ipc";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { VoiceTranscriptionService } from "../voice-transcription-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { parseVoiceModelRequest, parseVoiceSettings, parseVoiceTranscription } from "./voice-inputs";

export interface VoiceIpcDependencies {
  voice: VoiceTranscriptionService;
}

export function voiceIpcHandlers({ voice }: VoiceIpcDependencies): Pick<IpcGroupHandlers, "voice"> {
  return {
    voice: {
      getModelStatus: handler((): Promise<VoiceModelStatus> => runCauseEffect(voice.getModelStatus())),
      getModelStatuses: handler((): Promise<VoiceModelStatus[]> => runCauseEffect(voice.getModelStatuses())),
      prepareModel: handler((): Promise<VoiceModelStatus> => runCauseEffect(voice.prepareModel())),
      downloadModel: payloadHandler(
        parseVoiceModelRequest,
        ({ modelId }): Promise<VoiceModelStatus> => runCauseEffect(voice.downloadModel(modelId)),
      ),
      cancelModelDownload: payloadHandler(
        parseVoiceModelRequest,
        ({ modelId }): Promise<VoiceModelStatus> => runCauseEffect(voice.cancelModelDownload(modelId)),
      ),
      getSettings: handler((): VoiceSettings => voice.getSettings()),
      setSettings: payloadHandler(
        parseVoiceSettings,
        (settings): Promise<VoiceSettings> => runCauseEffect(voice.setSettings(settings)),
      ),
      transcribe: payloadHandler(
        parseVoiceTranscription,
        (transcription): Promise<VoiceTranscriptionResult> => runCauseEffect(voice.transcribe(transcription.audio)),
      ),
    },
  };
}
