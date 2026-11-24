import type { AIProvider } from "@zhiye/ai/types";
import { isDirectAiProvider } from "@zhiye/ai/types";

type AiProviderCapabilityInput = {
	provider: AIProvider;
	baseURL?: string | null;
};

export function isDirectOpenAIProvider(input: Pick<AiProviderCapabilityInput, "provider" | "baseURL">) {
	return input.provider === "openai" && isDirectAiProvider(input);
}
