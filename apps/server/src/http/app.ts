import type { ReadWebFile } from "../static/web";
import type { Http2Bindings, HttpBindings } from "@hono/node-server";
import type { Context } from "hono";
import { BlockList, isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { prepareStagedBody, withStagedBody } from "@reactive-resume/api/features/storage/transport";
import { env } from "@reactive-resume/env/server";
import { handleOpenApi, handleOpenApiDocument } from "../openapi/handler";
import { handleApiCatalog, handleWellKnownFallback } from "../openapi/metadata";
import { handleRpc } from "../rpc/handler";
import { handleSchemaJson } from "../static/schema";
import { handleLlms, handlePagesSitemap, handleRobots, handleSitemap } from "../static/seo";
import { handleUpload } from "../static/uploads";
import { handleWebApp, serveWebDistStatic } from "../static/web";
import { handleAlias } from "./alias";
import { handleAuth } from "./auth";
import { handleCareerJobs } from "./career-jobs";
import { handleHealth } from "./health";
import { handleResumePdfDownload } from "./resume-pdf";

type ServerEnvironment = { Bindings: HttpBindings | Http2Bindings };

const getTrustedClient = (context: Context<ServerEnvironment>, proxies: BlockList): string => {
	try {
		const address = getConnInfo(context).remote.address?.trim();
		if (!address || !isIP(address)) return "unknown";
		const trusted = (ip: string) => proxies.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
		if (!trusted(address)) return address;
		const forwarded = context.req.header("x-forwarded-for");
		if (!forwarded) return address;
		const chain = forwarded.split(",").map((ip) => ip.trim());
		if (chain.some((ip) => !isIP(ip))) return address;
		let client = address;
		for (const hop of chain.reverse()) {
			if (!trusted(client)) break;
			client = hop;
		}
		return client;
	} catch {
		return "unknown";
	}
};

type AppOptions = {
	serveStatic?: boolean;
	trustedClient?: (request: Request) => string;
	readWebFile?: ReadWebFile;
};

export function createApp(options: AppOptions = {}) {
	const app = new Hono<ServerEnvironment>();
	const proxies = new BlockList();
	for (const range of env.TRUSTED_PROXIES) {
		const [address, prefix] = range.split("/");
		if (!address) continue;
		const family = isIP(address) === 4 ? "ipv4" : "ipv6";
		if (prefix === undefined) proxies.addAddress(address, family);
		else proxies.addSubnet(address, Number(prefix), family);
	}
	const client = (c: Context<ServerEnvironment>) => options.trustedClient?.(c.req.raw) ?? getTrustedClient(c, proxies);

	// The alias domain serves the same public pages; only the signed-in app's sections move to APP_URL.
	app.use("*", async (c, next) => handleAlias(c.req.raw) ?? (await next()));
	app.use("/auth/*", async (c, next) => {
		await next();
		// The app shell already carries a full policy that forbids framing; only add one where it's missing.
		if (!c.res.headers.has("Content-Security-Policy")) c.header("Content-Security-Policy", "frame-ancestors 'none'");
		c.header("X-Frame-Options", "DENY");
		c.header("Referrer-Policy", "no-referrer");
		c.header("Cache-Control", "no-store");
	});

	// Caps every body parsed in memory before authentication or validation can reject it. RPC allows a batch of
	// agent attachments (the same 160 MiB ceiling as staged Vercel bodies); auth payloads are small JSON or forms.
	const limitBody = (maxSize: number) =>
		bodyLimit({
			maxSize,
			onError: (c) => {
				c.header("Cache-Control", "no-store");
				return c.json(
					{
						defined: false,
						code: "PAYLOAD_TOO_LARGE",
						status: 413,
						message: "This request is too large. Use a smaller file and try again.",
					},
					413,
				);
			},
		});
	// Preview renders carry a whole document as JSON; under Vercel's 4.5 MB function body ceiling. A larger body (an
	// embedded data-URI picture) gets 413 and the app shows the saved server PDF instead.
	app.use("/api/openapi/resumes/pdf-renders", limitBody(4 * 1024 * 1024));
	app.use("/api/openapi/*", limitBody(40 * 1024 * 1024));
	// Hono's `/x/*` also matches `/x`, so each wildcard below covers its base path too.
	app.use("/api/rpc/*", limitBody(160 * 1024 * 1024));
	app.use("/api/auth/*", limitBody(1024 * 1024));
	app.use("/api/storage/stage", limitBody(64 * 1024));

	app.post("/api/storage/stage", (c) => prepareStagedBody(c.req.raw));
	app.all("/api/rpc/*", (c) => withStagedBody(c.req.raw, (request) => handleRpc(request, client(c))));
	app.all("/api/openapi/*", (c) => handleOpenApi(c.req.raw, client(c)));
	app.all("/api/auth/*", (c) => handleAuth(c.req.raw, client(c)));
	app.get("/api/health", () => handleHealth());
	app.on(["GET", "POST"], "/api/career/run", (c) => handleCareerJobs(c.req.raw));
	app.get("/api/resumes/:id/pdf", (c) => handleResumePdfDownload(c.req.raw, c.req.param("id")));
	app.get("/api/uploads/*", (c) => handleUpload(c.req.raw));
	app.get("/uploads/*", (c) => handleUpload(c.req.raw));
	app.get("/schema.json", () => handleSchemaJson());
	app.get("/openapi.json", () => handleOpenApiDocument());
	// Hono answers HEAD by running the GET route and dropping the body, headers kept.
	app.get("/.well-known/api-catalog", () => handleApiCatalog());
	app.all("/.well-known/*", () => handleWellKnownFallback());

	app.get("/robots.txt", () => handleRobots());
	app.get("/sitemap.xml", () => handleSitemap());
	app.get("/sitemaps/pages.xml", () => handlePagesSitemap());
	app.get("/llms.txt", () => handleLlms());

	// Compresses only the web app's files and HTML shells: every route registered above answers before reaching
	// it, so API and upload streams are never buffered or re-encoded. Where a CDN serves the static files
	// (Vercel), it also compresses at its edge.
	if (options.serveStatic !== false) app.use("/*", compress());

	// Must precede the static middleware: serveStatic resolves "/" to dist/index.html and would
	// return it verbatim, skipping the OpenGraph/Twitter/canonical/JSON-LD injection in handleWebApp.
	app.on("GET", ["/", "/index.html"], (c) => handleWebApp(c.req.raw, options.readWebFile));
	if (options.serveStatic !== false && serveWebDistStatic) app.use("/*", serveWebDistStatic);
	app.get("/*", (c) => handleWebApp(c.req.raw, options.readWebFile));

	return app;
}
