import { describe, expect, it } from "vite-plus/test";
import { authSearchSchema, getAuthRedirectOptions } from "./redirect";

describe("authentication callback", () => {
	it.each([{}, { reauthenticate: true }])("accepts auth routes without a callback query: %j", (search) => {
		expect(authSearchSchema.parse(search)).toEqual(search);
	});
	it("preserves a server callback including repeated query values", () => {
		const callbackURL = "/api/auth/callback/google?code=one&state=two&state=three";
		expect(authSearchSchema.parse({ callbackURL })).toEqual({ callbackURL });
		expect(getAuthRedirectOptions(callbackURL)).toEqual({ href: callbackURL, reloadDocument: true, replace: true });
	});
	it.each([
		undefined,
		123,
		"https://evil.example",
		"//evil.example",
		"/\\evil.example",
		"/%2f%2fevil.example",
		"/%5cevil.example",
		"/\tevil.example",
		"javascript:alert(1)",
	])("falls back for unsafe callback %s", (callbackURL) => {
		expect(authSearchSchema.parse({ callbackURL }).callbackURL).toBeUndefined();
		expect(getAuthRedirectOptions(callbackURL)).toEqual({ href: "/dashboard", reloadDocument: false, replace: true });
	});
	it("accepts application paths without interpreting nested URL query values", () => {
		const callbackURL = "/dashboard?next=https%3A%2F%2Fexample.com";
		expect(authSearchSchema.parse({ callbackURL }).callbackURL).toBe(callbackURL);
	});
	it("routes internal SPA paths without reloading document", () => {
		expect(getAuthRedirectOptions("/dashboard")).toEqual({
			href: "/dashboard",
			reloadDocument: false,
			replace: true,
		});
		expect(getAuthRedirectOptions("/builder/resume-123")).toEqual({
			href: "/builder/resume-123",
			reloadDocument: false,
			replace: true,
		});
	});
});
