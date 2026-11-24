import type { DocumentsSearch } from "@/features/documents/documents-page";
import z from "zod";
import { templateSchema } from "@reactive-resume/schema/templates";

export const documentsSearchDefaults = {
	q: "",
	tags: [],
	sort: "edited",
} satisfies DocumentsSearch;

export const documentsSearchSchema = z.object({
	q: z
		.string()
		.transform((value) => value.slice(0, 500))
		.default("")
		.catch(""),
	tags: z
		.array(z.string())
		.transform((tags) => [...new Set(tags.filter(Boolean).map((tag) => tag.slice(0, 40)))].slice(0, 20))
		.default([])
		.catch([]),
	sort: z.enum(["edited", "name", "created"]).default("edited").catch("edited"),
	// Without one, the page uses the last view picked on this device.
	view: z.enum(["grid", "list"]).optional().catch(undefined),
	// A blank resume to start once signed in: "Use this template" in the gallery (with its template) and the ATS
	// checker's "Start a blank resume".
	new: z.literal("resume").optional().catch(undefined),
	template: templateSchema.optional().catch(undefined),
});

const keys = Object.keys(documentsSearchSchema.shape);

/**
 * Documents lived at `/dashboard` until Today took its place. This is the Documents search an address there carried
 * (bookmarks, emails), or undefined when it carried none.
 */
export function legacyDocumentsSearch(search: Record<string, unknown>) {
	return keys.some((key) => search[key] !== undefined) ? documentsSearchSchema.parse(search) : undefined;
}
