/**
 * Capability map checked against provider docs on 2026-10-22.
 *
 * deepseek-flash — https://api-docs.deepseek.com/guides/vision/
 *   and https://api-docs.deepseek.com/guides/thinking_mode
 *   Image input: JPEG, PNG, GIF, WebP. Chat Completions reasoning_effort
 *   accepts low, high, and max. Documented mappings: minimal→low, medium→high,
 *   xhigh→high. none disables thinking via thinking.type=disabled.
 *   Default: thinking enabled, effort high.
 *
 * gpt-5.4 — https://developers.openai.com/api/docs/models/gpt-5.4
 *   Image input: text and image. reasoning.effort: none (default), low, medium,
 *   high, xhigh. minimal and max are not listed for this model.
 *
 * gemini-3.8-flash — https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
 *   Image input, including JPEG, PNG, WEBP, HEIC, and HEIF.
 *   thinking_level: low, medium (default), high. minimal returns an error.
 *   none, xhigh, and max are not supported levels.
 */

export const EFFORT_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export type ProviderId = "deepseek" | "openai" | "gemini";

export interface ModelCapability {
  id: string;
  provider: ProviderId;
  keyEnv: "DEEPSEEK_API_KEY" | "OPENAI_API_KEY" | "GEMINI_API_KEY";
  endpoint: string;
  supportedEfforts: readonly EffortLevel[];
  /** Requested effort to the value actually sent. Absent means the level is unsupported. */
  effortMap: Partial<Record<EffortLevel, EffortLevel>>;
  documentedDefault: EffortLevel;
}

export const MODELS: Record<string, ModelCapability> = {
  "deepseek-flash": {
    id: "deepseek-flash",
    provider: "deepseek",
    keyEnv: "DEEPSEEK_API_KEY",
    endpoint: "https://api.deepseek.com/chat/completions",
    supportedEfforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
    effortMap: {
      none: "none",
      minimal: "low",
      low: "low",
      medium: "high",
      high: "high",
      xhigh: "high",
      max: "max",
    },
    documentedDefault: "high",
  },
  "gpt-5.4": {
    id: "gpt-5.4",
    provider: "openai",
    keyEnv: "OPENAI_API_KEY",
    endpoint: "https://api.openai.com/v1/chat/completions",
    supportedEfforts: ["none", "low", "medium", "high", "xhigh"],
    effortMap: {
      none: "none",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
    },
    documentedDefault: "none",
  },
  "gemini-3.8-flash": {
    id: "gemini-3.8-flash",
    provider: "gemini",
    keyEnv: "GEMINI_API_KEY",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    supportedEfforts: ["low", "medium", "high"],
    effortMap: {
      low: "low",
      medium: "medium",
      high: "high",
    },
    documentedDefault: "medium",
  },
};

export const DEFAULT_MODEL_ID = "deepseek-flash";

export function lookupModel(id: string): ModelCapability {
  const model = MODELS[id];
  if (!model) {
    const known = Object.keys(MODELS).join(", ");
    throw new Error(`Unknown model "${id}". Supported models: ${known}.`);
  }
  return model;
}

export type EffortBehaviour = "omitted_documented_default" | "sent" | "mapped" | "omitted_unsupported";

export interface ResolvedEffort {
  requested: "default" | EffortLevel;
  effective: EffortLevel;
  behaviour: EffortBehaviour;
  /** Value to send. null means omit the override. "none" on DeepSeek disables thinking. */
  sent: EffortLevel | null;
  notice: string | null;
}

export function resolveEffort(model: ModelCapability, requested: string): ResolvedEffort {
  if (requested === "default") {
    return {
      requested: "default",
      effective: model.documentedDefault,
      behaviour: "omitted_documented_default",
      sent: null,
      notice: null,
    };
  }
  if (!EFFORT_LEVELS.includes(requested as EffortLevel)) {
    throw new Error(
      `Unknown effort "${requested}". Use default, ${EFFORT_LEVELS.join(", ")}.`,
    );
  }
  const level = requested as EffortLevel;
  const mapped = model.effortMap[level];
  if (mapped === undefined) {
    return {
      requested: level,
      effective: model.documentedDefault,
      behaviour: "omitted_unsupported",
      sent: null,
      notice: `Effort "${level}" is not supported by ${model.id}. The override was omitted and the model default (${model.documentedDefault}) is used.`,
    };
  }
  if (mapped !== level) {
    return {
      requested: level,
      effective: mapped,
      behaviour: "mapped",
      sent: mapped,
      notice: `Effort "${level}" is sent as "${mapped}" for ${model.id}.`,
    };
  }
  return {
    requested: level,
    effective: mapped,
    behaviour: "sent",
    sent: mapped,
    notice: null,
  };
}
