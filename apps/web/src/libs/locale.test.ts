// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://localhost:3000"}

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import Cookies from "js-cookie";
import { changeLocale, getLocale, hasLocalePreference, loadLocale } from "./locale";

beforeEach(() => {
	Cookies.remove("locale");
	window.history.replaceState(null, "", "/");
	vi.stubGlobal("navigator", { languages: ["en-US"] });
	vi.spyOn(window.location, "reload").mockImplementation(() => {});
});

afterEach(() => {
	Cookies.remove("locale");
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("first-visit language", () => {
	it("does not activate a catalog whose account was replaced while it loaded", async () => {
		await loadLocale("en-US");
		await loadLocale("zh-CN", () => false);
		expect(i18n.locale).toBe("en-US");
		await loadLocale("zh-CN", () => true);
		expect(i18n.locale).toBe("zh-CN");
	});

	it("restores the saved account language without making it an explicit browser choice", () => {
		expect(getLocale("zh-CN")).toBe("zh-CN");
		expect(Cookies.get("locale")).toBeUndefined();
		expect(hasLocalePreference()).toBe(false);
		// A language the interface no longer ships falls back to the default.
		expect(getLocale("de-DE")).toBe("en-US");
		expect(getLocale()).toBe("en-US");
	});

	it.each([null, undefined, "unsupported"])("falls back to the browser for account locale %s", (saved) => {
		vi.stubGlobal("navigator", { languages: ["zh-TW"] });
		expect(getLocale(saved)).toBe("zh-CN");
		expect(hasLocalePreference()).toBe(false);
	});

	it("keeps explicit local and URL languages ahead of the account", () => {
		Cookies.set("locale", "zh-CN");
		expect(getLocale("en-US")).toBe("zh-CN");
		expect(hasLocalePreference()).toBe(true);
		window.history.replaceState(null, "", "/?locale=en-US");
		expect(getLocale("zh-CN")).toBe("en-US");
	});

	it("follows the browser without persisting an inferred choice", () => {
		vi.stubGlobal("navigator", { languages: ["unsupported", "de-DE", "zh-CN"] });
		window.history.replaceState({ key: "visit" }, "", "/ats-checker?campaign=first#check");
		const href = window.location.href;
		expect(getLocale()).toBe("zh-CN");
		expect(Cookies.get("locale")).toBeUndefined();
		expect(window.location.href).toBe(href);
		expect(window.history.state).toEqual({ key: "visit" });
		expect(window.location.reload).not.toHaveBeenCalled();
	});

	it.each([
		["?locale=zh-CN", "en-US", "zh-CN"],
		["?locale=en-US", undefined, "en-US"],
		["", "zh-CN", "zh-CN"],
		["?locale=unsupported", "zh-CN", "zh-CN"],
	])("keeps explicit URL %s and cookie %s ahead of browser language", (search, saved, expected) => {
		vi.stubGlobal("navigator", { languages: ["zh-CN"] });
		window.history.replaceState(null, "", `/${search}`);
		if (saved) Cookies.set("locale", saved);
		expect(getLocale()).toBe(expected);
		expect(Cookies.get("locale")).toBe(expected);
	});
});

describe("changeLocale", () => {
	it.each([
		["en-US", "zh-CN", "?filter=modern&locale=zh-CN&tag=one&tag=two"],
		["zh-CN", "en-US", "?filter=modern&tag=one&tag=two"],
	])("replaces %s with %s and persists the choice", (initial, selected, search) => {
		const state = { key: "current-page" };
		window.history.replaceState(state, "", `/resume-templates?filter=modern&locale=${initial}&tag=one&tag=two#gallery`);
		expect(getLocale()).toBe(initial);

		changeLocale(selected);

		expect(window.location.pathname).toBe("/resume-templates");
		expect(window.location.search).toBe(search);
		expect(window.location.hash).toBe("#gallery");
		expect(window.history.state).toEqual(state);
		expect(window.location.reload).toHaveBeenCalledOnce();
		expect(Cookies.get("locale")).toBe(selected);
		expect(getLocale()).toBe(selected);

		window.history.pushState(null, "", "/dashboard");
		expect(getLocale()).toBe(selected);
	});

	it("reloads even when the selected locale has the same URL", () => {
		window.history.replaceState(null, "", "/resume-templates#gallery");
		Cookies.set("locale", "zh-CN");

		changeLocale("en-US");

		expect(window.location.href).toBe("https://localhost:3000/resume-templates#gallery");
		expect(window.location.reload).toHaveBeenCalledOnce();
		expect(getLocale()).toBe("en-US");
	});

	it.each([null, "", "invalid"])("ignores invalid selection %s", (value) => {
		window.history.replaceState(null, "", "/resume-templates?locale=zh-CN#gallery");
		Cookies.set("locale", "zh-CN");
		const href = window.location.href;

		changeLocale(value);

		expect(window.location.href).toBe(href);
		expect(Cookies.get("locale")).toBe("zh-CN");
		expect(window.location.reload).not.toHaveBeenCalled();
	});
});
