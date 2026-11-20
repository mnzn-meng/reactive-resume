import z from "zod";

// oxlint-disable-next-line no-control-regex -- Reject URL parser whitespace and control-character normalization.
const unsafeCallbackCharacters = /[\\\u0000-\u0020\u007f]/;

function safeCallbackURL(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return;
	if (unsafeCallbackCharacters.test(value)) return;

	try {
		const pathname = decodeURIComponent(value.split(/[?#]/, 1)[0] ?? "");
		if (pathname.startsWith("//") || unsafeCallbackCharacters.test(pathname)) return;
		const url = new URL(value, "https://callback.invalid");
		if (url.origin !== "https://callback.invalid") return;
		return value;
	} catch {
		return;
	}
}

export const authSearchSchema = z.object({
	callbackURL: z.unknown().transform(safeCallbackURL).optional(),
	reauthenticate: z.boolean().optional().catch(undefined),
});

export function getAuthRedirectOptions(value: unknown) {
	const callbackURL = safeCallbackURL(value);
	// Server callbacks are endpoints, not pages; they must run through a document request.
	const isServerCallback = callbackURL !== undefined && callbackURL.startsWith("/api/");
	return { href: callbackURL ?? "/dashboard", reloadDocument: isServerCallback, replace: true } as const;
}

export function isRedirectResponse(data: unknown) {
	return (
		typeof data === "object" &&
		data !== null &&
		"redirect" in data &&
		data.redirect === true &&
		"url" in data &&
		typeof data.url === "string"
	);
}
