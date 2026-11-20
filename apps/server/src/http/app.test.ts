import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
	trustedProxies: [] as string[],
	handleAuth: vi.fn(),
	handleRpc: vi.fn(),
	handleOpenApi: vi.fn(),
	handleOpenApiDocument: vi.fn(),
	handleHealth: vi.fn(),
	handleUpload: vi.fn(),
	handleResumePdfDownload: vi.fn(),
	handleApiCatalog: vi.fn(),
	handleWellKnownFallback: vi.fn(),
	handleRobots: vi.fn(),
	handleSitemap: vi.fn(),
	handleLlms: vi.fn(),
	serveWebDistStatic: vi.fn(),
	handleWebApp: vi.fn(),
}));

vi.mock("@reactive-resume/env/server", async (original) => {
	const { env } = await original<typeof import("@reactive-resume/env/server")>();
	return { env: { ...env, TRUSTED_PROXIES: mocks.trustedProxies } };
});

vi.mock("./auth", () => ({
	handleAuth: mocks.handleAuth,
}));

vi.mock("./health", () => ({
	handleHealth: mocks.handleHealth,
}));

vi.mock("../rpc/handler", () => ({
	handleRpc: mocks.handleRpc,
}));

vi.mock("../openapi/handler", () => ({
	handleOpenApi: mocks.handleOpenApi,
	handleOpenApiDocument: mocks.handleOpenApiDocument,
}));

vi.mock("../openapi/metadata", () => ({
	handleApiCatalog: mocks.handleApiCatalog,
	handleWellKnownFallback: mocks.handleWellKnownFallback,
}));

vi.mock("../static/uploads", () => ({
	handleUpload: mocks.handleUpload,
}));

vi.mock("../static/seo", () => ({
	handleRobots: mocks.handleRobots,
	handleSitemap: mocks.handleSitemap,
	handleLlms: mocks.handleLlms,
}));

vi.mock("../static/web", () => ({
	serveWebDistStatic: mocks.serveWebDistStatic,
	handleWebApp: mocks.handleWebApp,
}));

vi.mock("./resume-pdf", () => ({
	handleResumePdfDownload: mocks.handleResumePdfDownload,
}));

const transportEnv = (remoteAddress: string) =>
	({
		incoming: { socket: { remoteAddress } },
	}) as never;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.trustedProxies.length = 0;
	mocks.handleAuth.mockResolvedValue(new Response("auth"));
	mocks.handleRpc.mockResolvedValue(new Response("rpc"));
	mocks.handleOpenApi.mockResolvedValue(new Response("openapi"));
	mocks.handleHealth.mockReturnValue(new Response("health"));
	mocks.handleUpload.mockResolvedValue(new Response("upload"));
	mocks.handleResumePdfDownload.mockResolvedValue(new Response("pdf"));
	mocks.handleApiCatalog.mockReturnValue(new Response("api-catalog"));
	mocks.handleOpenApiDocument.mockResolvedValue(new Response("openapi-document"));
	mocks.handleWellKnownFallback.mockReturnValue(new Response("well-known"));
	mocks.handleRobots.mockReturnValue(new Response("robots"));
	mocks.handleSitemap.mockReturnValue(new Response("sitemap"));
	mocks.handleLlms.mockReturnValue(new Response("llms"));
	mocks.serveWebDistStatic.mockResolvedValue(undefined);
	mocks.handleWebApp.mockResolvedValue(new Response("web"));
});

describe("createApp", () => {
	// The first case pays for the cold import of the whole app, which takes seconds under a parallel run.
	it.each(["/index.html", "/"])(
		"serves %s through the shared HTML response before static files",
		async (path) => {
			const { createApp } = await import("./app");
			const response = await createApp().request(path);
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("web");
			expect(mocks.serveWebDistStatic).not.toHaveBeenCalled();
		},
		15_000,
	);

	it.each([
		["127.0.0.1", "127.0.0.1", "198.51.100.1", "198.51.100.1"],
		["127.0.0.1", "::ffff:127.0.0.1", "198.51.100.1", "198.51.100.1"],
		["10.0.0.0/8", "10.2.3.4", "198.51.100.1, 10.3.4.5", "198.51.100.1"],
		["::1/128", "::1", "2001:db8::1", "2001:db8::1"],
		["127.0.0.1", "127.0.0.1", "192.0.2.99, 198.51.100.1", "198.51.100.1"],
		["127.0.0.1", "203.0.113.9", "198.51.100.1", "203.0.113.9"],
		["127.0.0.1", "127.0.0.1", "invalid, 198.51.100.1", "127.0.0.1"],
	])(
		"resolves auth client through trusted %s from socket %s",
		async (proxy, peer, forwarded, expected) => {
			mocks.trustedProxies.push(proxy);
			const { createApp } = await import("./app");
			const request = new Request("http://localhost/api/auth/sign-in/email", {
				headers: { "x-forwarded-for": forwarded },
			});
			await createApp().fetch(request, transportEnv(peer));
			expect(mocks.handleAuth).toHaveBeenCalledWith(request, expected);
		},
		15_000,
	);

	it("passes the transport address to RPC and OpenAPI and fails closed when it is unavailable", async () => {
		const { createApp } = await import("./app");
		const app = createApp();
		const trustedRpcRequest = new Request("http://localhost:3001/api/rpc", {
			headers: { "cf-connecting-ip": "198.51.100.1" },
		});
		const unknownRpcRequest = new Request("http://localhost:3001/api/rpc", {
			headers: { "cf-connecting-ip": "198.51.100.2" },
		});
		const trustedOpenApiRequest = new Request("http://localhost:3001/api/openapi/resumes/jane/resume");
		const unknownOpenApiRequest = new Request("http://localhost:3001/api/openapi/resumes/jane/resume");

		await app.fetch(trustedRpcRequest, transportEnv("203.0.113.9"));
		await app.fetch(unknownRpcRequest);
		await app.fetch(trustedOpenApiRequest, transportEnv("203.0.113.9"));
		await app.fetch(unknownOpenApiRequest);

		expect(mocks.handleRpc).toHaveBeenNthCalledWith(1, trustedRpcRequest, "203.0.113.9");
		expect(mocks.handleRpc).toHaveBeenNthCalledWith(2, unknownRpcRequest, "unknown");
		expect(mocks.handleOpenApi).toHaveBeenNthCalledWith(1, trustedOpenApiRequest, "203.0.113.9");
		expect(mocks.handleOpenApi).toHaveBeenNthCalledWith(2, unknownOpenApiRequest, "unknown");
	});

	it.each([
		["/openapi.json", "openapi-document"],
		["/.well-known/api-catalog", "api-catalog"],
	])("routes discovery document %s before the well-known fallback", async (path, body) => {
		const { createApp } = await import("./app");

		const response = await createApp().fetch(new Request(`http://localhost:3001${path}`));

		expect(await response.text()).toBe(body);
		expect(mocks.handleWellKnownFallback).not.toHaveBeenCalled();
	});

	it("compresses the web app's HTML but never API streams or the Vercel app", async () => {
		const { createApp } = await import("./app");
		const html = `<!doctype html>${"<p>Reactive Resume</p>".repeat(200)}`;
		const htmlResponse = () =>
			new Response(html, {
				headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "private, no-store", Vary: "Cookie" },
			});
		const stream = () => new Response("data: x\n\n".repeat(500), { headers: { "Content-Type": "application/json" } });
		mocks.handleWebApp.mockImplementation(async () => htmlResponse());
		mocks.handleRpc.mockImplementation(async () => stream());
		const headers = { "Accept-Encoding": "br, gzip" };

		const page = await createApp().request("http://localhost:3000/", { headers });
		const rpc = await createApp().request("http://localhost:3000/api/rpc/agent/chat", { headers });
		const vercelPage = await createApp({ serveStatic: false }).request("http://localhost:3000/", { headers });

		expect(page.headers.get("content-encoding")).toBe("gzip");
		expect(page.headers.get("vary")).toBe("Cookie, Accept-Encoding");
		expect(page.headers.get("cache-control")).toBe("private, no-store");
		expect(gunzipSync(Buffer.from(await page.arrayBuffer())).toString()).toBe(html);
		for (const response of [rpc, vercelPage]) expect(response.headers.get("content-encoding")).toBeNull();
		expect(vercelPage.headers.get("vary")).toBe("Cookie");
	});
});

it.each(["/auth/register", "/auth/register/", "/auth/login"])("prevents framing or caching %s", async (path) => {
	const { createApp } = await import("./app");
	mocks.serveWebDistStatic.mockImplementationOnce(async (_context: unknown, next: () => Promise<void>) => {
		await next();
	});
	const response = await createApp().request(`http://localhost:3000${path}?sig=signed`);
	expect(response.status).toBe(200);
	expect(await response.text()).toBe("web");
	expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
	expect(response.headers.get("x-frame-options")).toBe("DENY");
	expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	expect(response.headers.get("cache-control")).toBe("no-store");
});

it.each([
	{ path: "/api/openapi/files", limit: 40 * 1024 * 1024, handler: mocks.handleOpenApi },
	{ path: "/api/rpc/resume/import", limit: 160 * 1024 * 1024, handler: mocks.handleRpc },
	{ path: "/api/auth/sign-in/email", limit: 1024 * 1024, handler: mocks.handleAuth },
])("rejects oversized bodies for $path before parsing them", async ({ path, limit, handler }) => {
	const { createApp } = await import("./app");
	const response = await createApp().request(`http://localhost:3000${path}`, {
		method: "POST",
		headers: { "Content-Length": String(limit + 1) },
		body: "x",
	});
	expect(response.status).toBe(413);
	expect(await response.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(handler).not.toHaveBeenCalled();
});
