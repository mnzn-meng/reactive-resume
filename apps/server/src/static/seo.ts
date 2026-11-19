import { env } from "@reactive-resume/env/server";
import { templateSchema } from "@reactive-resume/schema/templates";
import { getLocaleAlternates } from "@reactive-resume/utils/locale";

export const CONTEXT7_ASK_URL = "https://context7.com/api/v2/ask?siteKey=ask_b3fd9335a63f1b21b1a814ac";
const CONTEXT7_ASK_DESCRIPTION = `This site has a search endpoint: ${CONTEXT7_ASK_URL}&query=<URL-encoded question>. It returns documentation that answers the question, with a source link for each part. No API key is needed. If nothing matches, it says so.`;

function appUrl() {
	return env.APP_URL.replace(/\/+$/, "");
}

function textResponse(body: string) {
	return new Response(body, {
		headers: { "Content-Type": "text/plain; charset=UTF-8" },
	});
}

export function handleRobots() {
	const baseUrl = appUrl();
	const body = [
		"User-agent: *",
		"Allow: /",
		"Disallow: /api/rpc",
		"Disallow: /api/auth",
		"Disallow: /mcp",
		"Disallow: /.well-known",
		// PDF and Word downloads are rendered per request; keep crawlers off them.
		"Disallow: /api/resumes/",
		// Discovery documents meant for agents and API directories.
		"Allow: /.well-known/integrations.json",
		"Allow: /.well-known/api-catalog",
		"Allow: /.well-known/mcp/server-card.json",
		"Allow: /.well-known/agent-skills/",
		"",
		`Sitemap: ${baseUrl}/sitemap.xml`,
		"",
	].join("\n");

	return textResponse(body);
}

// The marketing pages.
const sitemapPaths = ["/", "/ats-checker", "/resume-templates"];

const escapeXml = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** An XML document: the prologue, then `lines` inside the `<root …>` element. */
const xmlResponse = (root: string, lines: string[]) =>
	new Response(
		['<?xml version="1.0" encoding="UTF-8"?>', `<${root}>`, ...lines, `</${root.split(" ", 1)[0]}>`, ""].join("\n"),
		{
			headers: { "Content-Type": "application/xml; charset=UTF-8", "Cache-Control": "public, max-age=3600" },
		},
	);

/** The sitemap index: the marketing pages. */
export function handleSitemap() {
	const baseUrl = appUrl();
	return xmlResponse('sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"', [
		`  <sitemap><loc>${escapeXml(`${baseUrl}/sitemaps/pages.xml`)}</loc></sitemap>`,
	]);
}

export function handlePagesSitemap() {
	const baseUrl = appUrl();
	const urls = sitemapPaths.flatMap((path) => {
		const pageUrl = `${baseUrl}${path}`;
		const languages = getLocaleAlternates(pageUrl);
		const alternates = languages.map(
			({ hreflang, href }) => `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${escapeXml(href)}"/>`,
		);
		// x-default shares the English URL; each canonical URL appears once with the same alternate set.
		return [...new Set(languages.map(({ href }) => href))].map((href) =>
			["  <url>", `    <loc>${escapeXml(href)}</loc>`, ...alternates, "  </url>"].join("\n"),
		);
	});
	return xmlResponse(
		'urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"',
		urls,
	);
}

export function handleLlms() {
	const baseUrl = appUrl();
	const body = [
		"# Reactive Resume",
		"",
		`> Reactive Resume is a free resume builder. Write a resume in an editor beside a live page, pick one of ${templateSchema.options.length} templates, check that applicant tracking systems can read it, tailor it to a job posting, and download it. No ads, no tracking, no paid tier.`,
		"",
		"## Search",
		"",
		CONTEXT7_ASK_DESCRIPTION,
		"",
		"## Product",
		"",
		`- [Homepage](${baseUrl}/): what Reactive Resume does, with answers to common questions.`,
		`- [Resume templates](${baseUrl}/resume-templates): browse all ${templateSchema.options.length} free templates, compare layouts and download sample PDFs.`,
		`- [ATS checker](${baseUrl}/ats-checker): a free tool that shows the text applicant tracking systems extract from a resume PDF and what to fix. It runs in the browser; the file is never uploaded.`,
		`- [Get started](${baseUrl}/dashboard): create an account and a first resume.`,
		"",
		"## Facts",
		"",
		"- Price: free, every feature.",
		"- Export: PDF, Word (DOCX), Markdown and JSON.",
		"- Import: PDF, LinkedIn data export, JSON Resume, Reactive Resume JSON; Word files with an AI provider.",
		"- Private by default: a resume stays in the account and is never published to a link.",
		"- AI: optional, with the user's own API key (OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama and others). Nothing is sent to an AI service without one.",
		"- Also includes: cover letters, a job application tracker, version history, passkeys and two-factor authentication.",
		"- Languages: the interface is translated into more than 50 languages by volunteers.",
		"- Self-hosting: a Docker image, with PostgreSQL and local or S3-compatible storage.",
		"",
		"## API",
		"",
		`- [OpenAPI specification](${baseUrl}/openapi.json)`,
		`- [Resume JSON schema](${baseUrl}/schema.json)`,
		`- [MCP server](${baseUrl}/mcp): connect any MCP client with OAuth.`,
		`- [Agent skills](${baseUrl}/.well-known/agent-skills/index.json): resume and job-search skills.`,
		`- [Integrations](${baseUrl}/.well-known/integrations.json): every API and MCP surface with its authentication.`,
		"",
	].join("\n");

	return textResponse(body);
}
