import type { MobileAgent } from "@/features/workspace/model/workspace-types";

export type ChatTarget = Pick<MobileAgent, "id" | "serverId" | "name" | "avatarSeed" | "avatarHue"> & { kind: "agent" };
