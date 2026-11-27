import type { MessageDescriptor } from "@lingui/core";
import type { ResumeData } from "@zhiye/schema/resume/data";
import { msg } from "@lingui/core/macro";
import { stripHtml } from "@zhiye/utils/string";

/**
 * What to cut when a resume runs past the page, ranked by the height it would save. The design levers (density,
 * margins, type size) live in Fit; this is the other half — naming the words that are taking the room.
 */

type TrimKind = "summary" | "bullet" | "entry" | "keywords";

export type TrimSuggestion = {
	/** Stable across renders, so a list can keep its order and keys. */
	id: string;
	kind: TrimKind;
	/** A built-in section key or a custom section's id. */
	sectionId: string;
	itemId: string;
	/** Which list item to drop, for `bullet` suggestions. */
	bulletIndex?: number;
	/** What the reader would be removing, trimmed to one line. */
	text: string;
	/** Roughly how many typeset lines it occupies, at the document's current type size. */
	lines: number;
	label: MessageDescriptor;
};

/** A line of Chinese body text at 10 pt on A4 runs to about 38 characters; Latin to roughly twice that. */
const lineChars = (text: string) => (/\p{Script=Han}/u.test(text) ? 38 : 76);

const linesOf = (text: string) => {
	const clean = text.trim();
	if (!clean) return 0;
	return Math.ceil(clean.length / lineChars(clean));
};

const visible = (text: string) => stripHtml(text).replace(/\s+/g, " ").trim();

/** The `<li>` bodies of a description that is a plain list; null for prose, which has no bullets to drop. */
export const listItems = (html: string): string[] | null => {
	const trimmed = html.trim();
	const match = /^<ul>([\s\S]*)<\/ul>$/i.exec(trimmed);
	if (!match) return null;
	return [...(match[1] ?? "").matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((entry) => entry[1] ?? "");
};

export const withoutListItem = (html: string, index: number): string => {
	const items = listItems(html);
	if (!items) return html;
	const kept = items.filter((_, position) => position !== index);
	if (kept.length === 0) return "";
	return `<ul>${kept.map((item) => `<li>${item}</li>`).join("")}</ul>`;
};

/** An entry's description with the prose paragraphs dropped, leaving its bullets: what remains counts as height. */
const measured = (html: string) => {
	const items = listItems(html);
	if (items) return items.reduce((total, item) => total + linesOf(visible(item)), 0);
	return linesOf(visible(html));
};

const SUMMARY_TARGET_LINES = 3;
const BULLET_TARGET_LINES = 2;

const experienceLike = (data: ResumeData) => [
	{ sectionId: "experience", items: data.sections.experience.items },
	...data.customSections
		.filter((section) => section.type === "experience")
		.map((section) => ({ sectionId: section.id, items: section.items })),
];

/**
 * Everything worth considering cutting, longest first. `limit` keeps the list to what a reader can weigh at once.
 */
export function trimSuggestions(data: ResumeData, limit = 6): TrimSuggestion[] {
	const found: TrimSuggestion[] = [];

	const summaryLines = measured(data.summary.content);
	if (summaryLines > SUMMARY_TARGET_LINES) {
		found.push({
			id: "summary",
			kind: "summary",
			sectionId: "summary",
			itemId: "summary",
			text: `${visible(data.summary.content).slice(0, 80)}…`,
			lines: summaryLines - SUMMARY_TARGET_LINES,
			label: msg`Trim the summary`,
		});
	}

	for (const { sectionId, items } of experienceLike(data)) {
		for (const item of items) {
			if (item.hidden) continue;
			const bullets = listItems(item.description);
			if (!bullets) continue;
			bullets.forEach((bullet, index) => {
				const lines = linesOf(visible(bullet));
				if (lines < BULLET_TARGET_LINES) return;
				found.push({
					id: `${sectionId}:${item.id}:${index}`,
					kind: "bullet",
					sectionId,
					itemId: item.id,
					bulletIndex: index,
					text: visible(bullet).slice(0, 80),
					lines,
					label: msg`Drop this bullet`,
				});
			});
		}

		// The oldest entry is the one a shorter resume usually gives up first.
		const oldest = items.filter((item) => !item.hidden).at(-1);
		if (oldest && items.length > 2) {
			found.push({
				id: `${sectionId}:${oldest.id}:entry`,
				kind: "entry",
				sectionId,
				itemId: oldest.id,
				text: [oldest.company, oldest.position].filter(Boolean).join(" · ").slice(0, 80),
				lines: measured(oldest.description) + 2,
				label: msg`Remove the oldest entry`,
			});
		}
	}

	const keywords = data.sections.skills.items.flatMap((item) => item.keywords ?? []);
	if (keywords.length > 8) {
		found.push({
			id: "skills:keywords",
			kind: "keywords",
			sectionId: "skills",
			itemId: "skills",
			text: keywords.slice(8, 14).join("、"),
			lines: Math.ceil((keywords.length - 8) / 4),
			label: msg`Keep eight skills`,
		});
	}

	return found
		.filter((suggestion) => suggestion.lines > 0)
		.sort((left, right) => right.lines - left.lines)
		.slice(0, limit);
}
