import { describe, expect, it } from "vite-plus/test";
import { suggestApplicationDocuments } from "./document-suggestions";

const application = {
	id: "job",
	company: "  Cedar  ",
	status: "saved" as const,
	resumeId: null,
	sentResumeVersionId: null,
};
const resume = {
	id: "resume",
	name: "CEDAR — Portfolio",
	isLocked: false,
	trashedAt: null,
	application: null,
};

describe("company-named document suggestions", () => {
	it("uses the first eligible match without stealing another job's document", () => {
		const candidates = [
			{ ...resume, id: "unrelated", name: "Orbit — Portfolio" },
			{ ...resume, id: "locked", isLocked: true },
			{ ...resume, id: "trashed", trashedAt: new Date() },
			{ ...resume, id: "other-job", application: { id: "another-job" } },
			resume,
			{ ...resume, id: "older" },
		];
		expect(suggestApplicationDocuments(application, candidates)).toEqual([resume]);
		expect(suggestApplicationDocuments(application, [{ ...resume, application: { id: application.id } }])).toHaveLength(
			1,
		);
	});

	it.each([{ resumeId: "selected" }, { sentResumeVersionId: "sent" }])(
		"preserves a resume already selected or sent",
		(patch) => {
			expect(suggestApplicationDocuments({ ...application, ...patch }, [resume])).toEqual([]);
		},
	);

	it.each(["offer", "closed"] as const)("does not offer preparation for %s applications", (status) => {
		expect(suggestApplicationDocuments({ ...application, status }, [resume])).toEqual([]);
	});

	it("requires a nonblank literal company name", () => {
		expect(suggestApplicationDocuments({ ...application, company: "  " }, [resume])).toEqual([]);
		expect(suggestApplicationDocuments({ ...application, company: "%" }, [resume])).toEqual([]);
	});
});
