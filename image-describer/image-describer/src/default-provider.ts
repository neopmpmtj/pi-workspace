import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentDir } from "./env.ts";
import { DEFAULT_MODEL_ID, knownProvider, lookupModel, modelForProvider, type ProviderId } from "./models.ts";

export interface DefaultProvider {
  provider: ProviderId;
  model: string;
}

export function defaultProviderPath(env: NodeJS.ProcessEnv): string {
  return path.join(agentDir(env), "default-provider.json");
}

export function implicitDefaultProvider(): DefaultProvider {
  const model = lookupModel(DEFAULT_MODEL_ID);
  return { provider: model.provider, model: model.id };
}

export async function readDefaultProvider(env: NodeJS.ProcessEnv): Promise<DefaultProvider | undefined> {
  let text: string;
  try {
    text = await readFile(defaultProviderPath(env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return parseSelection(text);
}

export async function writeDefaultSelection(
  env: NodeJS.ProcessEnv,
  input: { provider?: string; model?: string },
): Promise<DefaultProvider> {
  const saved = selection(input);
  await mkdir(agentDir(env), { recursive: true });
  await writeFile(defaultProviderPath(env), `${JSON.stringify(saved, null, 2)}\n`, "utf8");
  return saved;
}

function selection(input: { provider?: string; model?: string }): DefaultProvider {
  const providerText = input.provider?.trim();
  const modelText = input.model?.trim();
  if (input.provider !== undefined && !providerText) throw new Error("Default provider must not be empty.");
  if (input.model !== undefined && !modelText) throw new Error("Default model must not be empty.");
  if (providerText && modelText) {
    const provider = knownProvider(providerText);
    const model = lookupModel(modelText);
    if (model.provider !== provider) {
      throw new Error(`Model "${model.id}" belongs to ${model.provider}, not ${provider}.`);
    }
    return { provider, model: model.id };
  }
  if (providerText) {
    const provider = knownProvider(providerText);
    return { provider, model: modelForProvider(provider).id };
  }
  if (modelText) {
    const model = lookupModel(modelText);
    return { provider: model.provider, model: model.id };
  }
  throw new Error("Default provider or model must not be empty.");
}

function parseSelection(text: string): DefaultProvider {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("default-provider.json is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("default-provider.json must be an object with provider and model strings.");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.provider !== "string" || typeof record.model !== "string") {
    throw new Error("default-provider.json must be an object with provider and model strings.");
  }
  const provider = knownProvider(record.provider);
  const model = lookupModel(record.model);
  if (model.provider !== provider) {
    throw new Error(`default-provider.json pairs ${provider} with ${model.id}, which belongs to ${model.provider}.`);
  }
  return { provider, model: model.id };
}
