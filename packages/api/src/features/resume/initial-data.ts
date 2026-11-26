import type { ResumeData } from "@zhiye/schema/resume/data";
import type { Template } from "@zhiye/schema/templates";
import type { Locale } from "@zhiye/utils/locale";
import { defaultResumeData } from "@zhiye/schema/resume/default";
import { sampleResumeData } from "@zhiye/schema/resume/sample";
import { EMPTY_SEMANTIC_CSS_SOURCE } from "@zhiye/schema/resume/stylesheet";

const LETTER_LOCALES: ReadonlySet<string> = new Set(["en-US", "en-CA", "es-MX", "fr-CA"]);

type CreateResumeDataOptions = {
	withSampleData?: boolean;
	/** The person the resume is for, printed as its name: the account holder's name, not the document's. */
	name?: string;
	/** The account's email, for the contact line of a blank resume. */
	email?: string | undefined;
	locale?: Locale;
	template?: Template | undefined;
};

export function createResumeData(options: CreateResumeDataOptions): ResumeData {
	const data = structuredClone(options.withSampleData ? sampleResumeData : defaultResumeData);

	// A sample keeps its fictional person: printing the account's name (or "Guest") on someone else's career misleads.
	const name = options.name?.trim();
	if (name && !options.withSampleData) data.basics.name = name;
	// A sample keeps its own fictional contact details.
	const email = options.email?.trim();
	if (email && !options.withSampleData) data.basics.email = email;
	if (options.locale) data.metadata.page.locale = options.locale;
	if (!options.withSampleData) {
		// A blank resume starts on a readable pairing in the document's own script: a serif heading over a sans body.
		// Chinese text set in a Latin face falls back glyph by glyph, which never lines up with the Latin parts of the page.
		const chinese = options.locale === "zh-CN";
		data.metadata.typography.heading.fontFamily = chinese ? "Noto Serif SC" : "Source Serif 4";
		// CJK faces ship Regular and Bold only, so ask for the weights they actually have.
		data.metadata.typography.heading.fontWeights = chinese ? ["700"] : ["600"];
		data.metadata.typography.body.fontFamily = chinese ? "Noto Sans SC" : "Source Sans 3";
		data.metadata.typography.body.fontWeights = ["400", "700"];
		data.metadata.design.colors.primary = "rgba(47, 90, 138, 1)";
		// Interests, volunteering and references are not part of a resume's first page here; they stay one toggle away.
		data.sections.interests.hidden = true;
		data.sections.volunteer.hidden = true;
		data.sections.references.hidden = true;
		// Where Letter is the paper people print on.
		if (options.locale && LETTER_LOCALES.has(options.locale)) data.metadata.page.format = "letter";
	}
	if (options.template) data.metadata.template = options.template;
	data.metadata.stylesheet = {
		mode: "semantic",
		source: { languageVersion: 1, text: EMPTY_SEMANTIC_CSS_SOURCE },
	};

	return data;
}
