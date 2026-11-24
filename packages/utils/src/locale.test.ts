import { describe, expect, it } from "vite-plus/test";
import {
	getLocaleAlternates,
	getLocaleScript,
	getPreferredLocale,
	isLocale,
	localeSchema,
	localizedUrl,
	supportedLocales,
} from "./locale";

it.each([
	[["en-US"], "en-US"],
	[["zh-CN"], "zh-CN"],
	// A language tag matches the shipped language it belongs to, whatever its region or script.
	[["zh"], "zh-CN"],
	[["zh-TW"], "zh-CN"],
	[["zh-Hans"], "zh-CN"],
	[["ZH-cn"], "zh-CN"],
	// Languages the interface no longer ships fall through to the next preference, then to the default.
	[["de-DE"], "en-US"],
	[["de-AT", "zh-CN"], "zh-CN"],
	[["unsupported", "fr-CA"], "en-US"],
	[[], "en-US"],
])("matches ordered language preferences %j to %s", (languages, expected) => {
	expect(getPreferredLocale(languages)).toBe(expected);
});

it("ships two interface languages and keeps the testing catalog out of them", () => {
	expect(supportedLocales).toEqual(["en-US", "zh-CN"]);
	// The schema still knows every tag a stored account or document may carry.
	expect(isLocale("zu-ZA")).toBe(true);
	expect(localeSchema.options.length).toBeGreaterThan(supportedLocales.length);
	expect(getLocaleAlternates("https://rxresu.me/")).toHaveLength(supportedLocales.length + 1);
});

it("maps the Armenian locale to its script", () => {
	expect(getLocaleScript("hy-AM")).toBe("armenian");
});

describe("locale URLs", () => {
	it("keeps the default locale on the plain address and puts others in the locale parameter", () => {
		expect(localizedUrl("https://rxresu.me/?locale=zh-CN", "en-US")).toBe("https://rxresu.me/");
		expect(localizedUrl("https://rxresu.me/", "zh-CN")).toBe("https://rxresu.me/?locale=zh-CN");
	});

	it("lists an alternate for each shipped language and the default", () => {
		expect(getLocaleAlternates("https://rxresu.me/")).toEqual([
			{ hreflang: "en-US", href: "https://rxresu.me/" },
			{ hreflang: "zh-CN", href: "https://rxresu.me/?locale=zh-CN" },
			{ hreflang: "x-default", href: "https://rxresu.me/" },
		]);
	});
});
