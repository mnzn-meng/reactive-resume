import type { TrimSuggestion } from "./trim";
import type { ResumeData } from "@zhiye/schema/resume/data";
import type { WritableDraft } from "immer";
import { withoutListItem } from "./trim";

/** Applies one suggestion to the draft, as the writer would: one undo step, nothing else touched. */
export function applyTrim(draft: WritableDraft<ResumeData>, suggestion: TrimSuggestion): void {
	if (suggestion.kind === "summary") {
		const limit = 3 * 38;
		const text = draft.summary.content
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (text.length > limit) {
			const cut = text.slice(0, limit);
			const end = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("."));
			draft.summary.content = `<p>${end > limit / 2 ? cut.slice(0, end + 1) : cut}…</p>`;
		}
		return;
	}

	if (suggestion.kind === "keywords") {
		let kept = 0;
		for (const item of draft.sections.skills.items) {
			const keywords = item.keywords ?? [];
			const room = Math.max(0, 8 - kept);
			item.keywords = keywords.slice(0, room);
			kept += item.keywords.length;
		}
		return;
	}

	const section =
		suggestion.sectionId === "experience"
			? draft.sections.experience
			: draft.customSections.find((candidate) => candidate.id === suggestion.sectionId);
	if (!section) return;

	const items = section.items as { id: string; description: string }[];

	if (suggestion.kind === "entry") {
		section.items = (section.items as unknown[]).filter(
			(item) => (item as { id: string }).id !== suggestion.itemId,
		) as never[];
		return;
	}

	const item = items.find((candidate) => candidate.id === suggestion.itemId);
	if (!item || suggestion.bulletIndex === undefined) return;
	item.description = withoutListItem(item.description, suggestion.bulletIndex);
}
