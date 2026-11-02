import type { AskRequest } from "./args.ts";
import type { DefaultModel } from "./default-model.ts";

export interface EffectiveChoice {
  provider?: string;
  model?: string;
  effort?: string;
}

/**
 * Flags beat the saved default, and a model given on the command line carries no
 * provider with it: taking the saved provider along would resolve a different
 * provider's model against the wrong catalog (`deepseek/gpt-5.4`). The provider
 * is inferred from the model instead, unless `--provider` says otherwise.
 */
export function effectiveChoice(
  request: Pick<AskRequest, "provider" | "model" | "effort">,
  defaults: DefaultModel | null,
): EffectiveChoice {
  const provider = request.provider ?? (request.model === undefined ? defaults?.provider : undefined);
  const model = request.model ?? defaults?.model;
  const effort = request.effort ?? defaults?.thinking;
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  };
}
