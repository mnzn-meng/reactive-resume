import { expect, it } from "vite-plus/test";
import { groupDocumentsByApplication, groupIsExpanded } from "./document-groups";

const job = (id: string, status: "saved" | "applied" | "closed") => ({
	id,
	company: `${id} Co`,
	role: "Engineer",
	status,
});

const resume = (id: string, applicationId: string | null, status: "saved" | "applied" | "closed" = "applied") => ({
	id,
	application: applicationId ? job(applicationId, status) : null,
});

it("puts each job's resumes together where its first document appears, even when jobs alternate", () => {
	const groups = groupDocumentsByApplication([
		resume("base", null),
		resume("job-resume", "northwind"),
		resume("two", "second"),
		resume("job-copy", "northwind"),
	]);

	expect(groups.map((group) => group.kind)).toEqual(["document", "application", "application"]);
	expect(groups.map((group) => group.documents.map((document) => document.id))).toEqual([
		["base"],
		["job-resume", "job-copy"],
		["two"],
	]);
});

it("marks closed jobs collapsed by default and lets an explicit choice win", () => {
	const groups = groupDocumentsByApplication([resume("closed", "old", "closed")]);
	const group = groups[0];
	expect(group?.closed).toBe(true);
	if (!group) throw new Error("missing group");

	expect(groupIsExpanded(group.closed, new Map(), group.key)).toBe(false);
	expect(groupIsExpanded(group.closed, new Map([[group.key, true]]), group.key)).toBe(true);
	expect(groupIsExpanded(false, new Map([[group.key, false]]), group.key)).toBe(false);
});
