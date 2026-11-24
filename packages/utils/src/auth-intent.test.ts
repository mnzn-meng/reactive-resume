import { describe, expect, it } from "vite-plus/test";
import { isSessionIntentPath } from "./auth-intent";

describe("session intent paths", () => {
	it.each([
		"/api/auth/sign-in/email",
		"/api/auth/sign-up/email",
		"/api/auth/sign-out",
		"/api/auth/callback/google",
		"/api/auth/reset-password",
		"/api/auth/forget-password",
		"/api/auth/anonymous",
		"/api/auth/one-tap/callback",
		"/api/auth/verify-email",
	])("treats %s as a session intent", (path) => {
		expect(isSessionIntentPath(path)).toBe(true);
	});

	it.each([
		"/api/auth/update-user",
		"/api/auth/change-email",
		"/api/auth/delete-user",
		"/api/auth/set-password",
		"/api/auth/link-social",
		"/api/auth/unlink-account",
		"/api/auth/passkey/update-passkey",
		"/other/api/auth/sign-in/email",
		"/api/auth/send-verification-email",
		"/api/rpc/career/saveProfile",
	])("keeps %s account-bound", (path) => {
		expect(isSessionIntentPath(path)).toBe(false);
	});
});
