import { expect, it, vi } from "vite-plus/test";
import { strFromU8, unzipSync } from "fflate";
import { defaultResumeData } from "@zhiye/schema/resume/default";

vi.mock("./pdf-document", () => ({ createResumePdfBlob: vi.fn() }));
const { createExportFile } = await import("./use-resume-export");

it("marks editor list paragraphs in browser Word downloads", async () => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.summary.content = "<ul><li><p>Editor bullet</p></li><li>Plain bullet</li></ul>";
	const blob = await createExportFile({ name: "Ada", data }, "docx");
	const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
	const documentXml = files["word/document.xml"];
	const numberingXml = files["word/numbering.xml"];
	if (!documentXml || !numberingXml) throw new Error("Missing Word list definitions");
	const xml = strFromU8(documentXml);
	expect(xml.match(/<w:numPr>/g)).toHaveLength(2);
	expect(xml).toContain("Editor bullet");
	expect(xml).toContain("Plain bullet");
	expect(strFromU8(numberingXml)).toContain('<w:numFmt w:val="bullet"/>');
});

it.each(["docx", "odt"] as const)("preserves highlight colors and code shading in %s downloads", async (format) => {
	const data = structuredClone(defaultResumeData);
	data.summary.content =
		'<p><mark>Yellow</mark> <mark data-color="#00ff00">Green</mark> <mark data-color="#000000">Dark</mark> <code>Code</code></p>';
	const blob = await createExportFile({ name: "Highlights", data }, format);
	const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
	const content = files[format === "docx" ? "word/document.xml" : "content.xml"];
	if (!content) throw new Error("Missing document content");
	const xml = strFromU8(content);
	for (const color of ["ffff00", "00ff00", "000000", "eeeeee"])
		expect(xml.toLowerCase()).toContain(format === "docx" ? `w:fill="${color}"` : `fo:background-color="#${color}"`);
	expect(xml.toLowerCase()).toContain(format === "docx" ? 'w:color w:val="ffffff"' : 'fo:color="#ffffff"');
	for (const text of ["Yellow", "Green", "Dark", "Code"]) expect(xml).toContain(text);
});

it("preserves highlight markup in JSON and visible text in Markdown downloads", async () => {
	const data = structuredClone(defaultResumeData);
	data.summary.content = '<p><mark data-color="#00ff00">Highlighted</mark> <code>Code</code></p>';
	const resume = { name: "Highlights", data };
	const json = await createExportFile(resume, "json");
	expect(JSON.parse(await json.text()).summary.content).toBe(data.summary.content);
	const md = await createExportFile(resume, "md");
	expect(await md.text()).toContain("Highlighted Code");
});
