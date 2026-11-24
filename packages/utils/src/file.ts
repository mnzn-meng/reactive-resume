import fileNameWords from "./file-name-words.json";
import { slugify } from "./slug";

export function generateFilename(prefix: string, extension?: string) {
	const name = slugify(prefix);
	return `${name}${extension ? `.${extension}` : ""}`;
}

export type FileNameSource = {
	name: string;
	data: { basics: { name: string }; metadata?: { page?: { locale?: string } } };
};

const words: Record<string, Record<string, string>> = fileNameWords;

/** "Resume" in the document's own language, as a recruiter reading the file name would expect. */
function documentWords(locale: string | undefined) {
	const translated = locale ? words[locale]?.Resume : undefined;
	if (!translated || translated === "Resume") return ["Resume"];
	return sanitizeFileName(translated).split(/\s+/).filter(Boolean);
}

// Control characters can break headers, and the rest are rejected by Windows and macOS.
// oxlint-disable-next-line no-control-regex -- matching the control ranges is the point.
const UNSAFE_FILE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g;
const FILE_NAME_EDGES = /^[.\s]+|[.\s]+$/g;

/** A file name without path separators, control characters, or characters file systems reject. */
export const sanitizeFileName = (value: string) =>
	value.replace(UNSAFE_FILE_NAME_CHARACTERS, "").replace(FILE_NAME_EDGES, "");

/**
 * "First-Last-Resume": recruiters see this name. Without a name on the document it falls back to the
 * document's name.
 */
export function getDefaultFileName(source: FileNameSource) {
	const split = (text: string) => sanitizeFileName(text).split(/\s+/).filter(Boolean);
	const person = split(source.data.basics.name);
	const suffix = documentWords(source.data.metadata?.page?.locale);
	if (person.length > 0) return [...person, ...suffix].join("-");
	const name = split(source.name);
	return name.join("-") || suffix.join("-");
}

export function downloadWithAnchor(blob: Blob, filename: string) {
	const a = document.createElement("a");
	const url = URL.createObjectURL(blob);

	a.href = url;
	a.rel = "noopener";
	a.download = filename;

	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** "12 kB" or "3.4 MB" (decimal units), never less than 1 kB. */
export function formatFileSize(bytes: number, locale: string): string {
	const inMegabytes = bytes >= 1_000_000;
	return new Intl.NumberFormat(locale, {
		style: "unit",
		unit: inMegabytes ? "megabyte" : "kilobyte",
		maximumFractionDigits: inMegabytes ? 1 : 0,
	}).format(inMegabytes ? bytes / 1_000_000 : Math.max(1, Math.round(bytes / 1000)));
}
