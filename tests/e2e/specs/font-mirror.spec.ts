import { execFileSync } from "node:child_process";
import { expect, test } from "../fixtures/test";

// Operator smoke gate: run against the mirror prepared in docs/self-hosting/fonts.mdx.
test("uses the configured mirror for browser and server PDFs", async ({ authPage: page }, testInfo) => {
	test.skip(!process.env.FONT_MIRROR_URL, "Requires a prepared FONT_MIRROR_URL (see the font self-hosting guide).");
	test.setTimeout(180_000);
	const mirror = process.env.FONT_MIRROR_URL ?? "";
	const external: string[] = [];
	const hostPattern = /^https:\/\/(fonts\.gstatic\.(?:com|cn)|cdn\.jsdelivr\.net)\//;
	await page.context().route(hostPattern, async (route) => {
		external.push(route.request().url());
		await route.abort();
	});
	const flags = await page.request.get("/api/openapi/flags");
	expect(await flags.json()).toMatchObject({ fontMirrorUrl: mirror.replace(/\/+$/, "") });
	const created = await page.request.post("/api/openapi/resumes", {
		data: { name: `Mirror ${testInfo.testId}`, tags: [] },
	});
	expect(created.ok()).toBe(true);
	const id = (await created.json()) as string;
	const saved = await page.request.get(`/api/openapi/resumes/${id}`);
	const { data } = await saved.json();
	data.basics.name = "Font mirror";
	data.summary.content = "<p>English <strong>bold</strong> and <em>italic</em>. 字体镜像 → ★ ✓. الخبرة العملية.</p>";
	data.metadata.page.locale = "zh-CN";
	data.metadata.typography.body.fontFamily = "Source Sans 3";
	data.metadata.typography.body.fontWeights = ["400", "700"];
	data.metadata.typography.heading.fontFamily = "Computer Modern Bright";
	data.metadata.typography.heading.fontWeights = ["400", "700"];
	expect((await page.request.put(`/api/openapi/resumes/${id}`, { data: { data } })).ok()).toBe(true);
	await page.goto(`/builder/${id}`);
	const downloaded = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download PDF", exact: true }).click();
	const download = await downloaded;
	expect(await download.failure()).toBeNull();
	const path = await download.path();
	if (!path) throw new Error("Browser did not save the PDF");
	const extracted = execFileSync("pdftotext", ["-enc", "UTF-8", path, "-"], { encoding: "utf8" });
	expect(extracted).toContain("字体镜像");
	expect(extracted).toContain("→");
	const serverPdf = await page.request.get(`/api/openapi/resumes/${id}/pdf`);
	expect(serverPdf.status()).toBe(200);
	expect((await serverPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
	await page.getByRole("tab", { name: "Design", exact: true }).click();
	await page.getByRole("button", { name: /^Typography/ }).click();
	await page.getByLabel("Font", { exact: true }).first().click();
	await page.getByLabel("Search fonts", { exact: true }).fill("Source Sans 3");
	await expect
		.poll(() =>
			page.evaluate(() =>
				[...document.fonts].some(
					(font) => font.family.includes("rr-preview-Source%20Sans%203") && font.status === "loaded",
				),
			),
		)
		.toBe(true);
	await page.keyboard.press("Escape");
	expect(external).toEqual([]);
});
