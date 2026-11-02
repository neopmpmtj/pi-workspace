import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentDir } from "./env.ts";

export interface FrontAndCenterImage {
  filename: string;
  description: string;
}

export function frontAndCenterPath(env: NodeJS.ProcessEnv): string {
  return path.join(agentDir(env), "front-and-center.md");
}

/** One markdown document for the whole run. Filenames are relative to dir. */
export function frontAndCenterDocument(input: {
  runId: string;
  recordedAt: string;
  dir: string;
  images: FrontAndCenterImage[];
}): string {
  const sections = input.images
    .map((image) => `## ${image.filename}\n\n${image.description.trim()}`)
    .join("\n\n");
  return `# Front and center

- Run: ${input.runId}
- Recorded: ${input.recordedAt}
- Directory: ${input.dir}

${sections}
`;
}

export async function writeFrontAndCenter(
  env: NodeJS.ProcessEnv,
  input: { runId: string; recordedAt: string; dir: string; images: FrontAndCenterImage[] },
): Promise<void> {
  if (input.images.length === 0) return;
  await mkdir(agentDir(env), { recursive: true });
  await writeFile(frontAndCenterPath(env), frontAndCenterDocument(input), "utf8");
}
