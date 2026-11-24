import type { CareerWorkspace } from "../career";
import type { ApplicationStatus, ApplicationTimelineEntry } from "./data";
import { hasApplicationSubmission } from "./data";

type PreparationApplication = {
	status: ApplicationStatus;
	activity: readonly ApplicationTimelineEntry[];
	jobDescription: string | null;
	resumeId: string | null;
	resumeFileUrl: string | null;
};

/** Persisted indices never move when a document or answer subject is absent. */
export function applicationReviewChecks(application: PreparationApplication, workspace: CareerWorkspace) {
	const review = workspace.submissionReview;
	const submitted = review !== undefined || hasApplicationSubmission(application);
	const documents = submitted ? review?.documents === true : Boolean(application.resumeId || application.resumeFileUrl);
	const answers = submitted ? review?.answers === true : workspace.answers.length > 0;
	return {
		submitted,
		recorded: review != null,
		checklist: submitted ? (review?.checklist ?? []) : workspace.checklist,
		indices: ([0, 1, 2, 3] as const).filter((index) =>
			index === 0 ? documents : index === 1 ? documents || answers : index === 2 ? answers : !submitted,
		),
	};
}

/** Guidance only: the existing review checks are user acknowledgements, never proof of submission or quality. */
export function nextPreparationStep(
	application: PreparationApplication,
	workspace: Pick<CareerWorkspace, "checklist" | "answers" | "submissionReview">,
	documents?: readonly { id: string }[],
) {
	if (workspace.submissionReview !== undefined || hasApplicationSubmission(application)) return "submitted";
	if (application.status === "closed") return "closed";
	if (!application.jobDescription?.trim()) return "posting";
	const resumeSelected =
		Boolean(application.resumeId) && (!documents || documents.some((document) => document.id === application.resumeId));
	if (!resumeSelected && !application.resumeFileUrl) return "resume";
	if (!workspace.checklist.includes(1)) return "tailor";
	if (
		workspace.answers.some((answer) => !answer.question.trim() || !answer.answer.trim()) ||
		(workspace.answers.length > 0 && !workspace.checklist.includes(2))
	)
		return "answers";
	return "review";
}

/**
 * Tailoring edits the copy made for this job, never a base resume other jobs share. True only once the documents are
 * loaded and the selected resume was made for this application; until then the step offers the copy instead.
 */
export function isJobCopy(
	application: { id: string; resumeId: string | null },
	documents?: readonly { id: string; application: { id: string } | null }[],
) {
	const resume = documents?.find((document) => document.id === application.resumeId);
	return resume?.application?.id === application.id;
}
