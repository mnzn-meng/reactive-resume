import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import { createResumeName } from "./data";

/**
 * Creates a sample resume named after the test and opens it in the editor. It goes through the API: the JSON import
 * spec covers the New dialog, and every other spec just needs a resume.
 */
export async function createSampleResumeFromDashboard(page: Page, testInfo: TestInfo) {
	const resumeName = createResumeName(testInfo);

	const response = await page.request.post("/api/openapi/resumes", {
		data: { name: resumeName, tags: [], withSampleData: true },
	});
	expect(response.ok()).toBe(true);
	const resumeId = (await response.json()) as string;

	await page.goto(`/builder/${resumeId}`);
	await page.waitForURL(/\/builder\/.+/);

	return resumeName;
}

export async function openSidebarSection(page: Page, title: string) {
	// Sharing is the Share mode, beside Write, Design and Check.
	if (title === "Sharing") {
		await page.getByRole("tab", { name: "Share", exact: true }).click();
		// A resume that was never published shows only Publish; the address and settings follow publishing.
		await expect(
			page.getByRole("textbox", { name: "Address" }).or(page.getByRole("button", { name: "Publish", exact: true })),
		).toBeVisible();
		return;
	}

	// Write has one level at a time: return to its outline, then open the requested section.
	await page.getByRole("tab", { name: "Write", exact: true }).click();
	const back = page.getByRole("button", { name: "Sections", exact: true });
	if (await back.isVisible()) await back.click();
	const builtIn = page.locator(`#sidebar-${title.toLowerCase()}`).getByRole("button", { name: title, exact: true });
	const row = (await builtIn.count()) > 0 ? builtIn : page.getByRole("button", { name: title, exact: true }).first();
	await row.click();
	await expect(page.locator(`#sidebar-${title.toLowerCase()}`)).toBeVisible();
}

/** Opens the Download menu, the ▾ next to Download PDF: each format is a row that downloads it. */
export async function openDownloadDialog(page: Page) {
	await page.getByRole("button", { name: "More download formats", exact: true }).click();
	const menu = page.getByRole("dialog", { name: "Download", exact: true });
	await expect(menu.getByRole("textbox", { name: "File name" })).toBeVisible();
	return menu;
}
