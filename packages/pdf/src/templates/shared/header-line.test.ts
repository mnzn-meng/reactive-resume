import { describe, expect, it } from "vite-plus/test";
import { defaultResumeData } from "@zhiye/schema/resume/default";
import { headerSubtitle } from "./header-line";

const basics = (headline: string, intent?: { position: string; city: string; availability: string }) => ({
	...defaultResumeData.basics,
	headline,
	...(intent ? { jobIntent: intent } : {}),
});

describe("headerSubtitle", () => {
	it("prints the headline alone when there is no job intent", () => {
		expect(headerSubtitle(basics("Backend Engineer"))).toBe("Backend Engineer");
	});

	it("prints the role, the city and the start date on the line under the name", () => {
		expect(headerSubtitle(basics("", { position: "后端工程师", city: "杭州", availability: "一个月内到岗" }))).toBe(
			"后端工程师 · 杭州 · 一个月内到岗",
		);
	});

	it("falls back to the intent's role when the headline is empty, and skips empty parts", () => {
		expect(headerSubtitle(basics("", { position: "后端工程师", city: "", availability: "" }))).toBe("后端工程师");
	});
});
