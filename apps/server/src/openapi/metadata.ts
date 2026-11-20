import { env } from "@reactive-resume/env/server";

function appUrl() {
	return env.APP_URL.replace(/\/+$/, "");
}

/** Nothing else is published under /.well-known, and a 404 says so; a 200 body would be parsed as the document asked for. */
export function handleWellKnownFallback() {
	return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** RFC 9727 API catalog: the REST API, with its description and documentation. */
export function handleApiCatalog() {
	const baseUrl = appUrl();
	const linkset = {
		linkset: [
			{
				anchor: `${baseUrl}/api/openapi`,
				"service-desc": [{ href: `${baseUrl}/openapi.json`, type: "application/vnd.oai.openapi+json" }],
				status: [{ href: `${baseUrl}/api/health`, type: "application/json" }],
			},
		],
	};

	return new Response(JSON.stringify(linkset), {
		headers: {
			"Content-Type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
			"Cache-Control": "public, max-age=3600",
			Link: `<${baseUrl}/.well-known/api-catalog>; rel="api-catalog"`,
		},
	});
}
