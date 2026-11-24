import { expect, it } from "vite-plus/test";
import { getDefaultFileName, sanitizeFileName } from "./file";

it.each([
	["李明", "李明-Resume"],
	["José Álvarez", "José-Álvarez-Resume"],
])("names a resume from its full name: %s", (name, filename) => {
	expect(getDefaultFileName({ name: "acme-tailored-v3", data: { basics: { name } } })).toBe(filename);
});

it.each(["///", " \t ", "\u202e"])("uses the document type when the name sanitizes to nothing: %j", (name) => {
	const source = { name, data: { basics: { name: "" } } };
	expect(getDefaultFileName(source)).toBe("Resume");
});

it("removes traversal, separators, control characters and header punctuation", () => {
	expect(sanitizeFileName("../../etc/passwd")).toBe("etcpasswd");
	expect(sanitizeFileName("..\\..\\windows\\evil")).toBe("windowsevil");
	expect(sanitizeFileName("a\r\nb\u0000c")).toBe("abc");
	expect(sanitizeFileName('a"b<c>d:e|f?g*h')).toBe("abcdefgh");
	expect(sanitizeFileName("\u202e李明-Resume.pdf")).toBe("李明-Resume.pdf");
});

it("names the file in the resume's own language", () => {
	const data = (locale: string) => ({ basics: { name: "Layla Haddad" }, metadata: { page: { locale } } });
	expect(getDefaultFileName({ name: "", data: data("zh-CN") })).toBe("Layla-Haddad-简历");
	expect(getDefaultFileName({ name: "", data: data("en-US") })).toBe("Layla-Haddad-Resume");
	// A language the interface no longer ships keeps the English word.
	expect(getDefaultFileName({ name: "", data: data("de-DE") })).toBe("Layla-Haddad-Resume");
});
