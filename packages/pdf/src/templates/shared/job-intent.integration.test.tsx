import { expect, it, vi } from "vite-plus/test";
import * as forme from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { latinSampleResumeData } from "@zhiye/schema/resume/sample-latin";
import { renderResume } from "../../forme/render";

// Forme's built-in faces are enough for this check; nothing downloads.
vi.mock("../../forme/fonts", () => ({ loadFonts: async () => ({ fonts: [], warnings: [], missing: [] }) }));

it("prints the job intent on the line under the name", async () => {
	const data = structuredClone(latinSampleResumeData);
	data.basics.headline = "";
	data.basics.jobIntent = { position: "Backend Engineer", city: "Hangzhou", availability: "Available now" };

	const rendered = await act(() => renderResume(forme, { data, template: "onyx" }));
	const loading = getDocument({ data: rendered.pdf.slice(), useSystemFonts: true });
	try {
		const pdf = await loading.promise;
		const first = await pdf.getPage(1);
		const text = (await first.getTextContent()).items.flatMap((item) => ("str" in item ? [item.str] : [])).join(" ");
		expect(text).toContain("Backend Engineer");
		expect(text).toContain("Hangzhou");
		expect(text).toContain("Available now");
	} finally {
		await loading.destroy();
	}
});
