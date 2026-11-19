import type { ResumeData } from "@reactive-resume/schema/resume/data";

/**
 * The resume a reviewer sees through a feedback link: the owner-only fields are gone.
 *
 *   - `data.metadata.notes` — documented as "only visible to the author when editing" in the resume schema.
 *   - `data.metadata.check` — the author's Check choices (ignored issues, job-posting terms hidden as "not true for me").
 *   - Everything the author hid: hidden sections, summary, picture and items "aren't printed or shared". Hidden custom
 *     sections are dropped; built-in ones keep their (now empty, untitled) slot because the schema requires it.
 *
 * Everything else, including `data.basics.name`, is part of what the reviewer reads.
 */
export function redactResumeForReviewer(data: ResumeData): ResumeData {
	const redacted = structuredClone(data);
	redacted.metadata.notes = "";
	redacted.metadata.check = undefined;
	if (redacted.picture.hidden) redacted.picture.url = "";
	if (redacted.summary.hidden) Object.assign(redacted.summary, { title: "", content: "" });
	redacted.customSections = redacted.customSections.filter((section) => !section.hidden);
	// A hidden built-in section keeps its slot but not its heading, which the author may have written privately too.
	for (const section of Object.values(redacted.sections)) if (section.hidden) section.title = "";
	const sections: { hidden: boolean; items: { hidden: boolean }[] }[] = [
		...Object.values(redacted.sections),
		...redacted.customSections,
	];
	for (const section of sections) section.items = section.hidden ? [] : section.items.filter((item) => !item.hidden);

	return redacted;
}
