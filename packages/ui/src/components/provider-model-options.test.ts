import type { AgentModelOption } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { pickerModels } from "./provider-model-options";

describe("pickerModels reasoning variants", () => {
  it("groups models with reasoning effort variants across providers", () => {
    const options: AgentModelOption[] = [
      {
        provider: "antigravity",
        id: "gemini-4-argon",
        name: "Gemini 4 Argon",
        description: "Base model",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["low", "medium", "high"],
      },
      {
        provider: "antigravity",
        id: "gemini-4-argon/low",
        name: "Gemini 4 Argon (low)",
        description: "Low effort variant",
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: ["low"],
      },
      {
        provider: "antigravity",
        id: "gemini-4-argon/high",
        name: "Gemini 4 Argon (high)",
        description: "High effort variant",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: ["high"],
      },
    ];

    const result = pickerModels(options);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("gemini-4-argon");
    expect(result[0]?.name).toBe("Gemini 4 Argon");
    expect(result[0]?.variants).toHaveLength(3);
    expect(result[0]?.variants.map((v) => v.id)).toEqual([
      "gemini-4-argon",
      "gemini-4-argon/low",
      "gemini-4-argon/high",
    ]);
  });
});
