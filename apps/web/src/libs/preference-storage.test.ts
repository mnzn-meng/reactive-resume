import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
// @vitest-environment happy-dom
import Cookies from "js-cookie";
import { getLocale } from "./locale";
import { getTheme, setThemeCookie } from "./theme";

describe("explicit browser preferences", () => {
	beforeEach(() => {
		Cookies.remove("locale");
		Cookies.remove("theme");
		window.history.replaceState(null, "", "/");
	});

	it("persists link language with an expiry, root path and SameSite", () => {
		const writes = vi.spyOn(document, "cookie", "set");
		window.history.replaceState(null, "", "/?locale=zh-CN");
		expect(getLocale()).toBe("zh-CN");
		const cookie = document.cookie;
		expect(cookie).toContain("locale=zh-CN");
		window.history.replaceState(null, "", "/dashboard");
		expect(getLocale()).toBe("zh-CN");
		// Exercise js-cookie serialization and the real DOM cookie jar.
		expect(writes.mock.calls.at(-1)?.[0]).toMatch(/expires=/i);
		expect(writes.mock.calls.at(-1)?.[0]).toMatch(/path=\//i);
		expect(writes.mock.calls.at(-1)?.[0]).toMatch(/SameSite=lax/i);
	});

	it("saves explicit theme through real cookies", () => {
		const writes = vi.spyOn(document, "cookie", "set");
		setThemeCookie("dark");
		expect(getTheme()).toBe("dark");
		expect(writes.mock.calls.at(-1)?.[0]).toMatch(/expires=/i);
	});
});
