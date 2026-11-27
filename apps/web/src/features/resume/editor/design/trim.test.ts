import type { ResumeData } from "@zhiye/schema/resume/data";
import { describe, expect, it } from "vite-plus/test";
import { sampleResumeData } from "@zhiye/schema/resume/sample";
import { listItems, trimSuggestions, withoutListItem } from "./trim";
import { applyTrim } from "./trim-apply";

const clone = () => structuredClone(sampleResumeData) as ResumeData;

describe("trimSuggestions", () => {
	it("names the summary before a short bullet, and never a one-line one", () => {
		const data = clone();
		data.summary.content = `<p>${"六年后端经验，专注高并发交易系统与稳定性建设。".repeat(8)}</p>`;
		const [first] = trimSuggestions(data);
		expect(first?.kind).toBe("summary");

		const short = trimSuggestions(data).filter((suggestion) => suggestion.kind === "bullet");
		expect(short.every((suggestion) => suggestion.lines > 0)).toBe(true);
	});

	it("ranks by the lines it would save", () => {
		const data = clone();
		const ranked = trimSuggestions(data);
		const lines = ranked.map((suggestion) => suggestion.lines);
		expect(lines).toEqual([...lines].sort((left, right) => right - left));
	});

	it("offers the oldest entry once a section has three", () => {
		const two = clone();
		two.sections.experience.items = two.sections.experience.items.slice(0, 2);
		expect(trimSuggestions(two).some((suggestion) => suggestion.kind === "entry")).toBe(false);

		const three = clone();
		const [first] = three.sections.experience.items;
		if (!first) throw new Error("The sample must carry an experience entry.");
		three.sections.experience.items.push({ ...structuredClone(first), id: "older" });
		const entry = trimSuggestions(three).find((suggestion) => suggestion.kind === "entry");
		expect(entry?.itemId).toBe("older");
	});

	it("leaves prose descriptions out of the bullet suggestions", () => {
		const data = clone();
		for (const item of data.sections.experience.items) item.description = "<p>一段没有要点的描述。</p>";
		expect(trimSuggestions(data).some((suggestion) => suggestion.kind === "bullet")).toBe(false);
	});
});

describe("list edits", () => {
	it("drops one listed item and keeps the rest in order", () => {
		const html = "<ul><li>第一点，写得比较长。</li><li>第二点。</li><li>第三点。</li></ul>";
		expect(listItems(html)).toHaveLength(3);
		expect(withoutListItem(html, 1)).toBe("<ul><li>第一点，写得比较长。</li><li>第三点。</li></ul>");
	});

	it("empties a list whose last item goes", () => {
		expect(withoutListItem("<ul><li>只有一点。</li></ul>", 0)).toBe("");
	});

	it("returns prose untouched", () => {
		const prose = "<p>一段文字。</p>";
		expect(withoutListItem(prose, 0)).toBe(prose);
	});
});

describe("applyTrim", () => {
	it("removes exactly the bullet the suggestion names", () => {
		const data = clone();
		const [item] = data.sections.experience.items;
		if (!item) throw new Error("The sample must carry an experience entry.");
		const before = listItems(item.description) ?? [];
		const suggestion = trimSuggestions(data).find(
			(candidate) => candidate.kind === "bullet" && candidate.itemId === item.id,
		);
		if (!suggestion) throw new Error("The sample must offer a bullet to drop.");

		applyTrim(data, suggestion);
		const after = listItems(item.description) ?? [];
		expect(after).toHaveLength(before.length - 1);
	});

	it("removes the entry the suggestion names", () => {
		const data = clone();
		const [first] = data.sections.experience.items;
		if (!first) throw new Error("The sample must carry an experience entry.");
		data.sections.experience.items.push({ ...structuredClone(first), id: "oldest" });
		const [entry] = trimSuggestions(data).filter((candidate) => candidate.kind === "entry");
		if (!entry) throw new Error("The sample must offer an entry to remove.");
		const before = data.sections.experience.items.length;

		applyTrim(data, entry);
		expect(data.sections.experience.items).toHaveLength(before - 1);
		expect(data.sections.experience.items.some((item) => item.id === entry.itemId)).toBe(false);
	});

	it("keeps eight skills across the section", () => {
		const data = clone();
		for (const item of data.sections.skills.items) {
			item.keywords = [...(item.keywords ?? []), "a", "b", "c", "d", "e"];
		}
		const suggestion = trimSuggestions(data).find((candidate) => candidate.kind === "keywords");
		if (!suggestion) throw new Error("The sample must offer skills to trim.");

		applyTrim(data, suggestion);
		const kept = data.sections.skills.items.reduce((total, item) => total + (item.keywords?.length ?? 0), 0);
		expect(kept).toBe(8);
	});
});
