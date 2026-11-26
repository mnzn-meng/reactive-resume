import { t } from "@lingui/core/macro";

/**
 * The server writes every page's canonical link, hreflang alternates, social cards and site-wide structured data into
 * the HTML it sends (apps/server/src/static/web.ts), so crawlers that never run JavaScript see them. Routes only set
 * what changes as the visitor navigates: the title, the description and, where needed, `noindex`.
 */

const appName = "职页";

export const createNoindexFollowMeta = () => ({ name: "robots", content: "noindex, follow" });

/** The homepage's title and description in the active locale. The prerendered page and the route share them. */
export const getHomepageMeta = () => ({
	title: `${t`Chinese resume builder: one page, PDF & Word`} | ${appName}`,
	description: t`Build a one-page Chinese resume with structured fields and Chinese typography, check that software can read the PDF, and export PDF or Word for free without a watermark.`,
});

/** The ATS checker's title and description in the active locale. The prerendered page and the route share them. */
export const getAtsCheckerMeta = () => ({
	title: `${t`Resume readability check`} | ${appName}`,
	// Keep under ~120 characters so Google's mobile SERP snippet is not truncated at 3 lines.
	description: t`Check whether screening software can read your resume PDF. Runs entirely in your browser, so your file is never uploaded.`,
});

export const getTemplatesMeta = () => ({
	title: `${t`Free Chinese resume templates with PDF samples`} | ${appName}`,
	description: t`Browse free Chinese resume templates, compare one-column and two-column layouts, and download sample PDFs. Customize your resume and export to PDF or Word.`,
});

/** Shared app and saved-document tab title. Marketing pages keep their own search titles. */
export const getPageTitle = (label: string) => `${label} | ${appName}`;
