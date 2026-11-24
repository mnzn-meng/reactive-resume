import { describe, expect, it, vi } from "vite-plus/test";
import { createProcedureClient } from "@orpc/server";
import { env } from "@zhiye/env/server";

const authMock = vi.hoisted(() => ({
	api: {
		getSession: vi.fn(),
	},
}));

const dbMock = vi.hoisted(() => ({
	select: vi.fn(),
}));

vi.mock("@zhiye/auth/config", () => ({ auth: authMock }));
vi.mock("@zhiye/db/client", () => ({ db: dbMock }));
vi.mock("@zhiye/db/schema", () => ({ user: { __table: "user" } }));
vi.mock("drizzle-orm", () => ({ eq: () => "EQ" }));
vi.mock("@zhiye/env/server", async (importOriginal) => {
	const { env } = await importOriginal<typeof import("@zhiye/env/server")>();
	return { env: { ...env, APP_ALIAS_URL: "https://rx.cv" } };
});

const { resolveUserFromRequestHeaders, publicProcedure, protectedProcedure } = await import("./context");

const setupDbResolves = (userResult: unknown) => {
	dbMock.select.mockReturnValueOnce({
		from: () => ({
			where: () => ({
				limit: () => Promise.resolve(userResult ? [userResult] : []),
			}),
		}),
	});
};

const reset = () => {
	authMock.api.getSession.mockReset();
	dbMock.select.mockReset();
};

describe("resolveUserFromRequestHeaders", () => {
	it("returns the account behind a valid session cookie", async () => {
		reset();
		authMock.api.getSession.mockResolvedValue({ user: { id: "owner" } });
		setupDbResolves({ id: "owner", name: "Ada" });

		const user = await resolveUserFromRequestHeaders(new Headers({ cookie: "session=valid" }));

		expect(user).toMatchObject({ id: "owner", name: "Ada" });
	});

	it.each([
		{ banned: true, banExpires: null, allowed: false },
		{ banned: true, banExpires: new Date("2999-01-01"), allowed: false },
		{ banned: true, banExpires: new Date("2000-01-01"), allowed: true },
	])("enforces active bans: %j", async ({ banned, banExpires, allowed }) => {
		reset();
		authMock.api.getSession.mockResolvedValue({ user: { id: "owner" } });
		setupDbResolves({ id: "owner", banned, banExpires });
		const result = await resolveUserFromRequestHeaders(new Headers({ cookie: "session=valid" }));
		expect(result?.id ?? null).toBe(allowed ? "owner" : null);
	});

	it("treats a failed session lookup as signed out", async () => {
		reset();
		authMock.api.getSession.mockRejectedValue(new Error("down"));
		await expect(resolveUserFromRequestHeaders(new Headers({ cookie: "session=valid" }))).resolves.toBeNull();
	});
});

describe("cookie request origins", () => {
	it.each([
		{ origin: "https://attacker.example" },
		{ origin: "null" },
		{ "sec-fetch-site": "cross-site" },
		{ origin: "https://rx.cv", "sec-fetch-site": "cross-site" },
		{ origin: "https://rx.cv.attacker.example", "sec-fetch-site": "same-origin" },
		{ origin: "http://rx.cv", "sec-fetch-site": "same-origin" },
		{ origin: "https://rx.cv:8443", "sec-fetch-site": "same-origin" },
	])("rejects ambient credentials from another origin: %j", async (originHeaders) => {
		reset();
		authMock.api.getSession.mockResolvedValue({ user: { id: "owner" } });
		const headers = new Headers({ cookie: "session=valid", ...originHeaders });
		await expect(resolveUserFromRequestHeaders(headers)).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(authMock.api.getSession).not.toHaveBeenCalled();
	});

	it("serves anonymous public procedures on the alias when incidental cookies are present", async () => {
		reset();
		authMock.api.getSession.mockResolvedValue(null);
		const context = {
			locale: "en-US" as const,
			reqHeaders: new Headers({ cookie: "theme=dark", origin: "https://rx.cv", "sec-fetch-site": "same-origin" }),
		};
		const publicOperation = createProcedureClient(
			publicProcedure.handler(({ context }) => context.user),
			{ context },
		);
		await expect(publicOperation(undefined)).resolves.toBeNull();
		const protectedOperation = createProcedureClient(
			protectedProcedure.handler(() => "private"),
			{ context },
		);
		await expect(protectedOperation(undefined)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("accepts same-origin cookies", async () => {
		reset();
		authMock.api.getSession.mockResolvedValue({ user: { id: "session-user" } });
		setupDbResolves({ id: "session-user" });
		await expect(
			resolveUserFromRequestHeaders(new Headers({ cookie: "session=valid", origin: new URL(env.APP_URL).origin })),
		).resolves.toMatchObject({ id: "session-user" });
	});

	it("accepts loopback alias origins for session cookies", async () => {
		reset();
		authMock.api.getSession.mockResolvedValue({ user: { id: "loopback-user" } });
		setupDbResolves({ id: "loopback-user" });
		const loopbackOrigin =
			new URL(env.APP_URL).hostname === "localhost" ? "http://127.0.0.1:3000" : "http://localhost:3000";
		await expect(
			resolveUserFromRequestHeaders(new Headers({ cookie: "session=valid", origin: loopbackOrigin })),
		).resolves.toMatchObject({ id: "loopback-user" });
	});
});

describe("account scope binding", () => {
	const signedIn = { id: "bob" } as never;
	const operation = (
		headers: Record<string, string>,
		method: "GET" | "POST" | "DELETE",
		handler = vi.fn(() => "executed"),
	) =>
		createProcedureClient(protectedProcedure.route({ method }).handler(handler), {
			context: { locale: "en-US" as const, reqHeaders: new Headers(headers), user: signedIn },
		});

	it.each(["POST", "DELETE"] as const)(
		"refuses a %s rendered for another account before the handler runs",
		async (method) => {
			reset();
			const handler = vi.fn(() => "executed");
			await expect(operation({ "x-account-id": "alice" }, method, handler)(undefined)).rejects.toMatchObject({
				code: "CONFLICT",
			});
			expect(handler).not.toHaveBeenCalled();
		},
	);

	it("accepts a write when the page's account matches the signed-in session", async () => {
		reset();
		await expect(operation({ "x-account-id": "bob" }, "POST")(undefined)).resolves.toBe("executed");
	});

	it("keeps clients that send no account scope working", async () => {
		reset();
		await expect(operation({}, "POST")(undefined)).resolves.toBe("executed");
	});

	it("still allows reads from a page that has not caught up with the new session", async () => {
		reset();
		await expect(operation({ "x-account-id": "alice" }, "GET")(undefined)).resolves.toBe("executed");
	});
});

describe("per-item account binding", () => {
	const signedIn = { id: "bob" } as never;
	const itemOperation = (
		envelope: string | undefined,
		item: string | undefined,
		method: "GET" | "POST" = "POST",
		handler = vi.fn(() => "executed"),
	) =>
		createProcedureClient(protectedProcedure.route({ method }).handler(handler), {
			context: {
				locale: "en-US" as const,
				reqHeaders: new Headers(envelope ? { "x-account-id": envelope } : {}),
				...(item ? { rpcItemAccountId: item } : {}),
				user: signedIn,
			},
		});

	it.each([
		{ envelope: "bob", item: "alice", why: "a mixed batch item keeps its own old account" },
		{ envelope: "alice", item: "bob", why: "the envelope and the item disagree" },
		{ envelope: undefined, item: "alice", why: "only the item is bound and it is stale" },
	])("refuses a write when $why", async ({ envelope, item }) => {
		reset();
		const handler = vi.fn(() => "executed");
		await expect(itemOperation(envelope, item, "POST", handler)(undefined)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		expect(handler).not.toHaveBeenCalled();
	});

	it.each([
		{ envelope: "bob", item: "bob" },
		{ envelope: "bob", item: undefined },
		{ envelope: undefined, item: "bob" },
		{ envelope: undefined, item: undefined },
	])("allows a write whose known bindings all match ($envelope / $item)", async ({ envelope, item }) => {
		reset();
		await expect(itemOperation(envelope, item)(undefined)).resolves.toBe("executed");
	});

	it("does not block a read item carrying another page's account", async () => {
		reset();
		await expect(itemOperation("bob", "alice", "GET")(undefined)).resolves.toBe("executed");
	});
});
