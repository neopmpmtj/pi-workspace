/** inputPhrase option names. COS and the control plane both import this list. */
export const inputPhraseOptions = ["normal", "advanced"] as const;

export type InputPhraseOption = (typeof inputPhraseOptions)[number];
