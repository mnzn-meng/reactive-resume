import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	handler: vi.fn(),
	accountLinkHook: undefined as
		| ((params: { fromUserId: string; toUserId: string; excludedStoragePrefixes: string[] }) => Promise<unknown>)
		| undefined,
	migrateUserStorage: vi.fn(),
	env: {
		SERVER_PORT: 3001,
		APP_URL: "http://localhost:3000",
	},
}));

vi.mock("@reactive-resume/auth/config", () => ({
	auth: {
		api: {
			getSession: mocks.getSession,
		},
		handler: mocks.handler,
	},
	setAccountLinkHook: (hook: typeof mocks.accountLinkHook) => {
		mocks.accountLinkHook = hook;
	},
}));

vi.mock("@reactive-resume/api/features/storage", () => ({
	migrateUserStorage: mocks.migrateUserStorage,
}));

vi.mock("@reactive-resume/db/client", () => ({ db: {} }));
vi.mock("@reactive-resume/db/schema", () => ({ verification: {} }));
vi.mock("@reactive-resume/env/server", () => ({
	env: mocks.env,
}));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.handler.mockResolvedValue(new Response("ok"));
});

describe("handleAuth", () => {
	it.each(["203.0.113.9", "unknown"])("uses only the adapter's client address (%s)", async (trustedClient) => {
		const { handleAuth } = await import("./auth");
		await handleAuth(
			new Request("http://localhost:3000/api/auth/get-session", {
				headers: {
					"cf-connecting-ip": "198.51.100.1",
					"true-client-ip": "198.51.100.2",
					"x-forwarded-for": "198.51.100.3, 192.0.2.1",
					"x-real-ip": "198.51.100.4",
				},
			}),
			trustedClient,
		);
		const request = mocks.handler.mock.calls[0]?.[0] as Request;
		expect(request.headers.get("cf-connecting-ip")).toBeNull();
		expect(request.headers.get("true-client-ip")).toBeNull();
		expect(request.headers.get("x-forwarded-for")).toBeNull();
		expect(request.headers.get("x-real-ip")).toBe(trustedClient === "unknown" ? null : trustedClient);
	});
});

describe("account-bound settings writes", () => {
	const request = (path: string, headers: Record<string, string> = {}, method = "POST") =>
		new Request(`http://localhost:3000${path}`, {
			method,
			headers: { "content-type": "application/json", ...headers },
			...(method === "GET" ? {} : { body: JSON.stringify({}) }),
		});

	it("refuses a stale account write before Better Auth runs", async () => {
		const { handleAuth } = await import("./auth");
		mocks.getSession.mockResolvedValueOnce({ user: { id: "bob" } });
		const response = await handleAuth(request("/api/auth/change-password", { "x-account-id": "alice" }));
		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toMatchObject({
			message: "This page belongs to a different account now. Reload and try again.",
		});
		expect(mocks.handler).not.toHaveBeenCalled();
	});

	it("allows the same account's settings write", async () => {
		const { handleAuth } = await import("./auth");
		mocks.getSession.mockResolvedValueOnce({ user: { id: "bob" } });
		const response = await handleAuth(request("/api/auth/update-user", { "x-account-id": "bob" }));
		expect(await response.text()).toBe("ok");
		expect(mocks.handler).toHaveBeenCalledOnce();
	});

	it("leaves clients without the optional header unchanged", async () => {
		const { handleAuth } = await import("./auth");
		await handleAuth(request("/api/auth/update-user"));
		expect(mocks.getSession).not.toHaveBeenCalled();
		expect(mocks.handler).toHaveBeenCalledOnce();
	});

	it("does not block explicit sign-out or sign-in intents", async () => {
		const { handleAuth } = await import("./auth");
		mocks.getSession.mockResolvedValue({ user: { id: "bob" } });
		await handleAuth(request("/api/auth/sign-out", { "x-account-id": "alice" }));
		await handleAuth(request("/api/auth/sign-in/email", { "x-account-id": "alice" }));
		expect(mocks.handler).toHaveBeenCalledTimes(2);
	});

	it("does not treat reads as writes", async () => {
		const { handleAuth } = await import("./auth");
		await handleAuth(request("/api/auth/get-session", { "x-account-id": "alice" }, "GET"));
		expect(mocks.getSession).not.toHaveBeenCalled();
		expect(mocks.handler).toHaveBeenCalledOnce();
	});
});

describe("account link storage migration", () => {
	it("sets an account link hook that delegates to migrateUserStorage", async () => {
		await import("./auth");
		const cleanup = vi.fn();
		mocks.migrateUserStorage.mockResolvedValueOnce(cleanup);
		expect(
			await mocks.accountLinkHook?.({
				fromUserId: "guest-old",
				toUserId: "user-new",
				excludedStoragePrefixes: ["uploads/guest-old/pdfs/erased"],
			}),
		).toBe(cleanup);
		expect(cleanup).not.toHaveBeenCalled();
		expect(mocks.migrateUserStorage).toHaveBeenCalledWith("guest-old", "user-new", ["uploads/guest-old/pdfs/erased"]);
	});
});
