import type { Locale } from "@reactive-resume/utils/locale";
import type { User } from "better-auth";
import { ORPCError, os } from "@orpc/server";
import { eq } from "drizzle-orm";
import { auth } from "@reactive-resume/auth/config";
import { getTrustedOrigins } from "@reactive-resume/auth/trusted-origins";
import { db } from "@reactive-resume/db/client";
import { user } from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { withAiDestination, withWebDestination } from "./features/ai/destination";

interface ORPCContext {
	locale: Locale;
	reqHeaders: Headers;
	resHeaders?: Headers;
	trustedClient?: string;
	/** Set only by a server adapter after resolving this request's account. */
	user?: User | null;
	/** The account expectation of this batch item (or whole request), mapped by the RPC adapter. */
	rpcItemAccountId?: string;
}

const TRUSTED_ORIGINS = getTrustedOrigins(env.APP_URL);
// The alias domain calls the same API, including when incidental cookies are present.
if (env.APP_ALIAS_URL) TRUSTED_ORIGINS.push(new URL(env.APP_ALIAS_URL).origin);

async function findActiveUser(id: string): Promise<User | null> {
	const [result] = await db.select().from(user).where(eq(user.id, id)).limit(1);
	if (!result || (result.banned && (!result.banExpires || result.banExpires > new Date()))) return null;
	return result;
}

/** Same-origin session cookies, or nothing. */
export async function resolveUserFromRequestHeaders(headers: Headers): Promise<User | null> {
	const origin = headers.get("origin");
	if (
		headers.has("cookie") &&
		((origin && !TRUSTED_ORIGINS.includes(origin)) || headers.get("sec-fetch-site") === "cross-site")
	) {
		throw new ORPCError("FORBIDDEN", {
			message: "This request came from another site. Open Reactive Resume directly and try again.",
		});
	}
	try {
		const result = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
		if (!result?.user) return null;
		return await findActiveUser(result.user.id);
	} catch {
		return null;
	}
}

const base = os.$context<ORPCContext>();

export const publicProcedure = base
	.route({ spec: (operation) => ({ ...operation, security: [] }) })
	.use(async ({ context, next }) => {
		const authenticated =
			context.user === undefined ? await resolveUserFromRequestHeaders(context.reqHeaders) : context.user;

		return next({
			context: {
				...context,
				user: authenticated ?? null,
			},
		});
	});

/** The scope a route needs. Moving a document to Trash removes it like a delete, so its RPC and REST aliases need
 * `delete` too. */
export function requiredPermission(route: { method?: string | undefined; operationId?: string | undefined }) {
	if (route.method === "GET") return "read";
	if (route.method === "DELETE" || /^(delete|bulkDelete|purge|trash)|^putDocumentTrash$/i.test(route.operationId ?? ""))
		return "delete";
	return "write";
}

export const protectedProcedure = publicProcedure
	.route({
		spec: (operation) => ({ ...operation, security: [{ cookieAuth: [] }] }),
	})
	.use(({ context, procedure, next }) => {
		if (!context.user) {
			throw new ORPCError("UNAUTHORIZED", {
				message: "Sign-in required.",
			});
		}
		const permission = requiredPermission(procedure["~orpc"].route);
		// A page sends the account it was rendered for. If a cookie changed after that page loaded (another tab signed
		// out or signed in), a queued autosave must fail instead of writing the old account's text into the new one.
		// Every known binding must agree with the authenticated user: the request envelope (cookie-level) and the
		// per-item binding a batch item may carry. A batch cannot relabel one item with another account's live scope.
		const bindings = [context.reqHeaders.get("x-account-id"), context.rpcItemAccountId].filter(
			(value): value is string => Boolean(value),
		);
		if (permission !== "read" && bindings.some((accountId) => accountId !== context.user?.id))
			throw new ORPCError("CONFLICT", {
				message: "This page belongs to a different account now. Reload and try again.",
			});

		const authenticatedUser = context.user;
		return withAiDestination(context.reqHeaders.get("x-ai-destination"), () =>
			withWebDestination(context.reqHeaders.get("x-web-destination"), () =>
				next({
					context: {
						...context,
						user: authenticatedUser,
					},
				}),
			),
		);
	});
