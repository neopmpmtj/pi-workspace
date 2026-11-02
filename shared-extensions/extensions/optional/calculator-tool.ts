/**
 * calculator-tool.ts — Registers a "calculator" tool the AI can call.
 *
 * API: pi.registerTool() — the third core extension API.
 *
 * The AI decides WHEN to use it and with WHAT expression.
 * Safer than the AI doing math in its head (LLMs can make arithmetic errors).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "calculator",
    label: "Calculator",
    description:
      "Evaluate a mathematical expression. Use this for any arithmetic, percentages, or calculations. Supports +, -, *, /, parentheses, and decimals.",

    parameters: Type.Object({
      expression: Type.String({
        description:
          "The math expression to evaluate, e.g. '2 + 3 * 4' or '100 / 7'",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      // Convert "15% of 847" or "15% of 847 + 200" into proper math
      let expr = params.expression
        .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s+(\d+(?:\.\d+)?)/gi, "($1/100)*$2")
        .replace(/(\d+(?:\.\d+)?)\s*%/g, "($1/100)");

      // Sanitize: only allow safe math characters
      const sanitized = expr.replace(/[^0-9+\-*/().%\s]/g, "");
      if (!sanitized.trim()) {
        return {
          content: [{ type: "text", text: "Error: empty or invalid expression" }],
          isError: true,
        };
      }

      try {
        // Note: eval is safe here because we've stripped everything except math chars
        const result = eval(sanitized);
        return {
          content: [
            {
              type: "text",
              text: `${params.expression} = ${result}`,
            },
          ],
        };
      } catch {
        return {
          content: [{ type: "text", text: `Error: could not evaluate "${params.expression}"` }],
          isError: true,
        };
      }
    },
  });
}
