import { describe, expect, it } from "vitest";
import { currentModelFromSessionSetup, modelsFromSessionSetup } from "./acp-configuration";

describe("acp-configuration model discovery and effort deduplication", () => {
  it("prefers canonical model configOptions over pre-multiplied availableModels", () => {
    // Fixture matching Antigravity ACP server 1.4.0 session/new response
    const response = {
      sessionId: "test-session-id",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select" as const,
          currentValue: "gemini-3.8-flash",
          options: [
            { value: "gemini-4-argon", name: "Gemini 4 Argon" },
            { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
          ],
        },
        {
          id: "thinking_level",
          name: "Thinking Level",
          category: "thought_level",
          type: "select" as const,
          currentValue: "high",
          options: [
            { value: "low", name: "Low" },
            { value: "medium", name: "Medium" },
            { value: "high", name: "High" },
          ],
        },
      ],
      models: {
        currentModelId: "gemini-3.8-flash-high",
        availableModels: [
          {
            modelId: "gemini-4-argon-medium",
            name: "Gemini 4 Argon (Medium)",
            description: "gemini-4-argon-medium",
          },
          {
            modelId: "gemini-4-argon-high",
            name: "Gemini 4 Argon (High)",
            description: "gemini-4-argon-high",
          },
          {
            modelId: "gemini-4-argon-low",
            name: "Gemini 4 Argon (Low)",
            description: "gemini-4-argon-low",
          },
          {
            modelId: "gemini-3.8-flash-high",
            name: "Gemini 3.8 Flash (High)",
            description: "gemini-3.8-flash-high",
          },
          {
            modelId: "gemini-3.8-flash-medium",
            name: "Gemini 3.8 Flash (Medium)",
            description: "gemini-3.8-flash-medium",
          },
          {
            modelId: "gemini-3.8-flash-low",
            name: "Gemini 3.8 Flash (Low)",
            description: "gemini-3.8-flash-low",
          },
        ],
      },
    };

    const models = modelsFromSessionSetup(response);
    expect(models).toHaveLength(2);
    expect(models.map((m) => m.id)).toEqual(["gemini-4-argon", "gemini-3.8-flash"]);
    expect(models.map((m) => m.name)).toEqual(["Gemini 4 Argon", "Gemini 3.8 Flash"]);
    expect(models[0]?.supportedReasoningEfforts).toEqual(["low", "medium", "high"]);
    expect(models[0]?.reasoningEffortConfigurable).toBe(true);

    const current = currentModelFromSessionSetup(response);
    expect(current).toBe("gemini-3.8-flash");
  });

  it("marks fixed-effort models as reasoningEffortConfigurable: false when no model config exists", () => {
    const response = {
      sessionId: "test-session-id",
      configOptions: [
        {
          id: "thinking_level",
          name: "Thinking Level",
          category: "thought_level",
          type: "select" as const,
          currentValue: "high",
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
        },
      ],
      models: {
        currentModelId: "gemini-4-argon-low",
        availableModels: [
          {
            modelId: "gemini-4-argon-low",
            name: "Gemini 4 Argon (Low)",
            description: "gemini-4-argon-low",
          },
        ],
      },
    };

    const models = modelsFromSessionSetup(response);
    expect(models).toHaveLength(1);
    expect(models[0]?.reasoningEffortConfigurable).toBe(false);
  });
});
