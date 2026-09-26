/**
 * persona-injector.ts — Adds a persona description to the system prompt.
 *
 * Station: before_agent_start
 * Method:  event.systemPromptOptions.appendSystemPrompt (section 6)
 *
 * Adds "The user is a high school student" between Pi's docs paths
 * and the project context. Preserves all other sections.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    if (event.systemPromptOptions) {
      event.systemPromptOptions.appendSystemPrompt =
        "\n\n" +
        "# User\n" +
        "- The user is a high school student and does not know much programming jargon — explain in common language.\n" +
        "\n" +
        "# Your responses\n" +
        "- Your responses must be short and concise so as not to overwhelm the user; " +
        "if asked to elaborate or extend, then repeat the answer in a longer manner " +
        "adding in context and an example where applicable for better comprehension; " +
        "but not too extensive for the same reason.\n" +
        "\n" +
        "## When the user prompts you with a simple \"hi\"\n" +
        "- respond only \"Hi\" back\n";
    }
  });
}
