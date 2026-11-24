import { ORPCError } from "@orpc/client";
import z from "zod";
import { applicationReviewSchema } from "@zhiye/ai/application-review";
import { askUserQuestionInputSchema, proposeEditsOutputSchema } from "@zhiye/ai/tools/agent-tool-contracts";
import { aiOperationIds } from "@zhiye/schema/ai-usage";
import { generateCareer } from "../career/generate";
import { resumeService } from "../resume/service";
import { reviewApplicationResume } from "./resume-review";

export const prepareInput = z.object({
	id: z.string(),
	questions: z.array(z.string().trim().min(1).max(2000)).max(5),
});
export const prepareOutput = applicationReviewSchema;

/** One consented operation, existing draft owners; no employer write and no document content mutation. */
export async function prepareApplication(
	input: z.infer<typeof prepareInput> & { userId: string; locale: string; signal?: AbortSignal | undefined },
) {
	const signal = AbortSignal.any([AbortSignal.timeout(240_000), ...(input.signal ? [input.signal] : [])]);
	const tailoring = await reviewApplicationResume({ userId: input.userId, id: input.id, signal });
	const resume = await resumeService.getById({ id: tailoring.resumeId, userId: input.userId });
	const sets = (tailoring.conversation?.messages ?? []).flatMap((message) =>
		message.parts.flatMap((part) => {
			if (part.type !== "tool-propose_edits" || !("state" in part) || part.state !== "output-available") return [];
			const parsed = proposeEditsOutputSchema.safeParse("output" in part ? part.output : undefined);
			return parsed.success
				? [
						{
							...parsed.data,
							messageId: message.id,
							toolCallId: "toolCallId" in part && typeof part.toolCallId === "string" ? part.toolCallId : "",
							aiOperationIds: aiOperationIds(message.metadata),
						},
					]
				: [];
		}),
	);
	const failed: string[] = tailoring.generationStatus === "interrupted" ? ["tailoring"] : [];
	const answers = await Promise.all(
		input.questions.map(async (question, index) => {
			try {
				const result = await generateCareer({
					userId: input.userId,
					applicationId: input.id,
					locale: input.locale,
					task: { task: "answer", question, answer: "" },
					signal,
				});
				if (!result.answer) throw new ORPCError("BAD_GATEWAY");
				return {
					question,
					answer: {
						answer: result.answer.text,
						factIds: result.answer.factIds,
						aiOperationIds: result.answer.aiOperationIds,
					},
					note: result.answer.note,
				};
			} catch {
				signal.throwIfAborted();
				failed.push(`question:${index + 1}`);
				return null;
			}
		}),
	);
	signal.throwIfAborted();
	return {
		threadId: tailoring.conversation?.thread.id ?? null,
		assistantText: (tailoring.conversation?.messages ?? [])
			.filter((message) => message.role === "assistant")
			.flatMap((message) =>
				message.parts.flatMap((part) => {
					if (part.type === "text") return [part.text];
					if (part.type !== "tool-ask_user_question") return [];
					const question = askUserQuestionInputSchema.safeParse("input" in part ? part.input : undefined);
					return question.success ? [question.data.question] : [];
				}),
			)
			.join("\n\n"),
		generationStatus: tailoring.generationStatus,
		resume,
		sets,
		answers: answers.filter((answer) => answer !== null),
		failed,
	};
}
