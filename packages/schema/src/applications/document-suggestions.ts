import type { ApplicationStatus } from "./data";

type Target = {
	id: string;
	company: string;
	status: ApplicationStatus;
	resumeId: string | null;
	sentResumeVersionId: string | null;
};

type Candidate = {
	name: string;
	isLocked: boolean;
	trashedAt: Date | string | null;
	application: { id: string } | null;
};

/** The first usable company-named resume, in the library's edited order. */
export function suggestApplicationDocuments<T extends Candidate>(application: Target, documents: readonly T[]): T[] {
	const company = application.company.trim().toLowerCase();
	if (!company || application.status === "offer" || application.status === "closed") return [];
	if (application.resumeId || application.sentResumeVersionId) return [];
	const match = documents.find(
		(document) =>
			!document.isLocked &&
			!document.trashedAt &&
			(!document.application || document.application.id === application.id) &&
			document.name.toLowerCase().includes(company),
	);
	return match ? [match] : [];
}
