import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
	env: { APP_URL: "https://rxresu.me", FONT_MIRROR_URL: undefined as string | undefined },
	serveStatic: vi.fn(() => vi.fn()),
}));

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => true),
}));

vi.mock("node:fs/promises", () => ({
	default: {
		readFile: vi.fn(),
	},
}));

vi.mock("@hono/node-server/serve-static", () => ({
	serveStatic: mocks.serveStatic,
}));

vi.mock("@reactive-resume/env/server", () => ({
	env: mocks.env,
}));

const { handleWebApp, contentSecurityPolicy } = await import("./web");

it("builds font-src with the application and configured mirror origins", () => {
	mocks.env.FONT_MIRROR_URL = "http://fonts.example.test:8080/resume";
	try {
		const policy = contentSecurityPolicy();
		expect(policy.split("; ").find((part) => part.startsWith("font-src"))).toBe(
			"font-src 'self' data: http://fonts.example.test:8080",
		);
		expect(policy).toContain("connect-src 'self' data: blob: https: http://fonts.example.test:8080");
	} finally {
		mocks.env.FONT_MIRROR_URL = undefined;
	}
});

const searchLink =
	'<https://context7.com/api/v2/ask?siteKey=ask_b3fd9335a63f1b21b1a814ac>; rel="search"; type="text/plain"; title="Search rxresu.me"';

describe("web app fallback classification", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.APP_URL = "https://rxresu.me";
		vi.mocked(fs.readFile).mockResolvedValue("<html>app</html>");
	});

	it.each(
		["https://rxresu.me", "https://resume.example.test"].flatMap((origin) =>
			["/", "/ats-checker", "/resume-templates", "/dashboard", "/auth/login"].map((path) => ({ origin, path })),
		),
	)("keeps search discovery declarative on $origin $path", async ({ origin, path }) => {
		mocks.env.APP_URL = origin;
		vi.mocked(fs.readFile).mockResolvedValue('<html><head></head><body><div id="app"></div></body></html>');
		const response = await handleWebApp(new Request(`${origin}${path}`));
		const html = await response.text();
		expect(html).toContain('<meta name="context7-site-verification" content="ask_b3fd9335a63f1b21b1a814ac"></head>');
		expect(html).not.toContain("data-context7-ask");
		expect(html).not.toContain("Page index:");
		expect(html).not.toContain("This site has a search endpoint:");
		expect(response.headers.get("Link")).toBe(searchLink);
		const head = await handleWebApp(new Request(`${origin}${path}`, { method: "HEAD" }));
		expect(head.headers.get("Link")).toBe(searchLink);
		expect(await head.text()).toBe("");
	});

	it("injects canonical metadata and structured data into tracking-parameter root requests only", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(`
			<!doctype html>
			<html>
				<head>
					<title>职页 — A free resume builder</title>
					<meta
						name="description"
						content="职页 is a free resume builder that makes it easy to create, update, and share your resume."
					>
				</head>
				<body><div id="app"></div></body>
			</html>
		`);

		const response = await handleWebApp(new Request("http://server.internal/?utm_source=search"));
		const html = await response.text();

		expect(html).toContain('<link rel="canonical" href="https://rxresu.me/">');
		expect(html).toContain('<meta property="og:url" content="https://rxresu.me/">');
		expect(html).toContain('<script type="application/ld+json">');
		expect(html).toContain(
			'<meta property="og:description" content="职页 is a free resume builder that makes it easy to create, update, and share your resume.">',
		);
		expect(html).not.toContain("utm_source");

		const dashboardResponse = await handleWebApp(new Request("https://example.com/dashboard"));
		expect(await dashboardResponse.text()).not.toContain('rel="canonical"');
	});

	it.each(["https://example.com/?locale=zu-ZA", "https://example.com/"])(
		"recovers a pseudo-locale request or cookie to readable public HTML: %s",
		async (url) => {
			vi.mocked(fs.readFile).mockImplementation((path) =>
				Promise.resolve(`<html><head></head><body>${String(path)}</body></html>`),
			);
			const response = await handleWebApp(new Request(url, { headers: { cookie: "locale=zu-ZA" } }));
			const html = await response.text();
			expect(html).toContain("dist-prerender/home/en-US.html");
			expect(html).not.toContain("zu-ZA");
		},
	);

	it("serves the homepage prerendered in the requested or saved locale, with hreflang alternates", async () => {
		vi.mocked(fs.readFile).mockImplementation((path) => {
			const locale = String(path).match(/dist-prerender\/home\/(.+)\.html$/)?.[1];
			return Promise.resolve(`<html><head></head><body><div id="app">${locale ?? "shell"}</div></body></html>`);
		});

		const chinese = await handleWebApp(new Request("https://example.com/?locale=zh-CN"));
		const html = await chinese.text();
		expect(html).toContain('<div id="app">zh-CN</div>');
		expect(html).toContain('<link rel="canonical" href="https://rxresu.me/?locale=zh-CN">');
		expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://rxresu.me/">');
		expect(chinese.headers.get("Vary")).toBe("Cookie");

		const saved = new Request("https://example.com/", { headers: { cookie: "theme=dark; locale=zh-CN" } });
		const savedHtml = await (await handleWebApp(saved)).text();
		expect(savedHtml).toContain('<div id="app">zh-CN</div>');
		expect(savedHtml).toContain('<link rel="canonical" href="https://rxresu.me/">');

		// A language the build no longer ships serves the default page instead.
		const retired = await handleWebApp(new Request("https://example.com/?locale=de-DE"));
		expect(await retired.text()).toContain('<div id="app">en-US</div>');

		// Only known locales name a file, so the parameter can't point anywhere else.
		const unknown = await handleWebApp(new Request("https://example.com/?locale=../../index"));
		expect(await unknown.text()).toContain('<div id="app">en-US</div>');
	});

	it("names structured data's language after the page, and English when the page falls back to the shell", async () => {
		vi.mocked(fs.readFile).mockImplementation((path) => {
			const locale = String(path).match(/dist-prerender\/home\/(.+)\.html$/)?.[1];
			return Promise.resolve(`<html><head></head><body><div id="app">${locale ?? "shell"}</div></body></html>`);
		});

		const chinese = await (await handleWebApp(new Request("https://example.com/?locale=zh-CN"))).text();
		expect(chinese).toContain('"inLanguage":"zh-CN"');

		vi.mocked(fs.readFile).mockImplementation((path) => {
			const locale = String(path).match(/dist-prerender\/home\/(.+)\.html$/)?.[1];
			if (locale === "zh-CN") return Promise.reject(new Error("missing"));
			return Promise.resolve(`<html><head></head><body><div id="app">${locale ?? "shell"}</div></body></html>`);
		});

		const missing = await (await handleWebApp(new Request("https://example.com/?locale=zh-CN"))).text();
		expect(missing).toContain('"inLanguage":"en-US"');
	});

	it("keeps shared HTML and its cache validators independent of browser language hints", async () => {
		vi.mocked(fs.readFile).mockImplementation((path) =>
			Promise.resolve(`<html><head></head><body>${String(path)}</body></html>`),
		);
		const german = await handleWebApp(new Request("https://rxresu.me/", { headers: { "accept-language": "de-DE" } }));
		const french = await handleWebApp(new Request("https://rxresu.me/", { headers: { "accept-language": "fr-FR" } }));
		const body = await german.text();
		expect(body).toContain("home/en-US.html");
		expect(await french.text()).toBe(body);
		expect(german.headers.get("ETag")).toBe(french.headers.get("ETag"));
		expect(german.headers.get("Vary")).toBe("Cookie");
		expect(german.headers.get("Set-Cookie")).toBeNull();
	});

	it("keeps query values inert and out of script authorization", async () => {
		const script = "window.ready = true;";
		const template = `<html><head></head><body><a href="/auth/login">Sign in</a><script>${script}</script></body></html>`;
		vi.mocked(fs.readFile).mockResolvedValue(template);
		const url = new URL("https://example.com/?locale=en-US");
		url.searchParams.set("campaign", '"><script>window.injected=true</script>&$&');
		const response = await handleWebApp(new Request(url));
		const html = await response.text();
		expect(html).toContain('<a href="/auth/login">Sign in</a>');
		expect(html.match(/<script>/g)).toHaveLength(1);
		expect(html).toContain(`<script>${script}</script>`);
		expect(response.headers.get("Content-Security-Policy")).toContain(
			`'sha256-${createHash("sha256").update(script).digest("base64")}'`,
		);
		expect(response.headers.get("Content-Security-Policy")).not.toContain(
			`'sha256-${createHash("sha256").update("window.injected=true").digest("base64")}'`,
		);
	});

	it.each(["ats-checker", "resume-templates"])(
		"serves the %s page as an indexable shell rather than a 404",
		async (path) => {
			vi.mocked(fs.readFile).mockResolvedValue(
				`<html><head><title>职页 — A free resume builder</title><meta name="description" content="Marketing copy."></head><body></body></html>`,
			);

			const response = await handleWebApp(new Request(`https://example.com/${path}`));

			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
			expect(response.headers.get("X-Robots-Tag")).toBeNull();
		},
	);

	it("serves a prerendered marketing page in the requested locale, with its own title on the social cards", async () => {
		vi.mocked(fs.readFile).mockImplementation((path) => {
			const locale = String(path).match(/dist-prerender\/ats-checker\/(.+)\.html$/)?.[1];
			if (!locale) return Promise.resolve("<html><head></head><body></body></html>");
			return Promise.resolve(
				`<html><head><title>ATS 检查与更多</title><meta name="description" content="可读性？"></head><body><div id="app">${locale}</div></body></html>`,
			);
		});

		const html = await (await handleWebApp(new Request("https://example.com/ats-checker?locale=zh-CN"))).text();

		expect(html).toContain('<div id="app">zh-CN</div>');
		expect(html).toContain('<link rel="canonical" href="https://rxresu.me/ats-checker?locale=zh-CN">');
		expect(html).toContain('<meta property="og:title" content="ATS 检查与更多">');
		expect(html).toContain('<meta property="og:locale" content="zh_CN">');
	});

	it.each(["/", "/dashboard"])("sets framing and CSP security headers on %s", async (pathname) => {
		const response = await handleWebApp(new Request(`https://example.com${pathname}`));

		expect(response.status).toBe(200);
		expect(response.headers.get("X-Frame-Options")).toBe("DENY");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
	});

	it("allows exactly the page's own inline scripts, by hash", async () => {
		const response = await handleWebApp(
			new Request("https://example.com/dashboard"),
			async () => '<html><script>boot()</script><script type="module" src="/app.js"></script></html>',
		);
		const scripts = response.headers.get("Content-Security-Policy")?.match(/script-src ([^;]*)/)?.[1];

		expect(scripts).toBe(
			`'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com 'sha256-${createHash("sha256").update("boot()").digest("base64")}'`,
		);
	});

	it("tags pages for the release purge and preloads their stylesheet and fonts for Early Hints", async () => {
		const response = await handleWebApp(
			new Request("https://example.com/"),
			async () =>
				'<html><head><link rel="icon" href="/favicon.ico"><link rel="stylesheet" crossorigin href="/assets/index-a.css"><link rel="preload" as="font" type="font/woff2" href="/assets/figtree-b.woff2" crossorigin></head><body><div id="app"></div></body></html>',
		);

		expect(response.headers.get("Cache-Tag")).toBe("html");
		expect(response.headers.get("Link")).toBe(
			`${searchLink}, </assets/index-a.css>; rel=preload; as=style; crossorigin, </assets/figtree-b.woff2>; rel=preload; as=font; crossorigin`,
		);
	});

	it.each(["/builder/resume-1", "/agent"])("serves a noindex shell for the app's own page %s", async (pathname) => {
		const response = await handleWebApp(new Request(`https://example.com${pathname}`));

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
		expect(response.headers.get("X-Robots-Tag")).toBe("noindex, follow");
		expect(await response.text()).toBe("<html>app</html>");
	});

	it("serves a feedback link's page as the app, never indexed and without a referrer", async () => {
		const pathname = "/feedback/0190f3a2-7c1e-7000-8000-000000000000~AbC_dEf-123";
		const response = await handleWebApp(new Request(`https://example.com${pathname}`));
		expect(response.status).toBe(200);
		expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
		expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
		expect(await response.text()).toBe("<html>app</html>");
	});

	it("sends /templates to the template gallery", async () => {
		const response = await handleWebApp(new Request("https://example.com/templates?locale=de-DE"));

		expect(response.status).toBe(301);
		expect(response.headers.get("Location")).toBe("/resume-templates?locale=de-DE");
	});

	it.each(["/templates/azurill", "/templates/azurill.pdf"])(
		"returns 404 for retired template preview %s",
		async (pathname) => {
			const response = await handleWebApp(new Request(`https://example.com${pathname}`));

			expect(response.status).toBe(404);
			expect(await response.text()).not.toContain("<html>app</html>");
			expect(fs.readFile).not.toHaveBeenCalled();
		},
	);
});
