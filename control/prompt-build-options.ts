/** promptBuild option names. COS and the control plane both import this list. */
export const promptBuildOptions = [
  "1-Personal",
  "2-Development",
  "3-Work",
  "4-Automatic",
  "5-Research",
] as const;

export type PromptBuildOption = (typeof promptBuildOptions)[number];
