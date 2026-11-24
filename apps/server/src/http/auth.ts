import { isIP } from "node:net";
import { migrateUserStorage } from "@zhiye/api/features/storage";
import { auth, setAccountLinkHook } from "@zhiye/auth/config";
import { isSessionIntentPath } from "@zhiye/utils/auth-intent";
import { TRUSTED_IP_HEADERS } from "@zhiye/utils/rate-limit";

setAccountLinkHook(({ fromUserId, toUserId, excludedStoragePrefixes }) =>
	migrateUserStorage(fromUserId, toUserId, excludedStoragePrefixes),
);

/**
 * Account settings writes from the browser name the account whose page rendered them. If the cookie now belongs to a
 * different account (another tab signed out or in), applying that write would change the wrong user; refuse it before
 * Better Auth runs any effect. Requests without the header, and explicit sign-in/up/out intents, are unchanged.
 */
async function rejectMismatchedAccount(request: Request) {
	const expected = request.headers.get("x-account-id");
	if (!expected || request.method === "GET" || request.method === "HEAD") return null;
	if (isSessionIntentPath(new URL(request.url).pathname)) return null;
	const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
	if (!session?.user || session.user.id === expected) return null;
	return Response.json(
		{ message: "This page belongs to a different account now. Reload and try again." },
		{ status: 409, headers: { "Cache-Control": "no-store" } },
	);
}

export async function handleAuth(incomingRequest: Request, trustedClient = "unknown") {
	// Only the server adapter may supply the client address. Never forward client-sent proxy headers to auth.
	const headers = new Headers(incomingRequest.headers);
	for (const name of TRUSTED_IP_HEADERS) headers.delete(name);
	if (isIP(trustedClient)) headers.set("X-Real-IP", trustedClient);
	const request = new Request(incomingRequest, { headers });

	const mismatchedAccount = await rejectMismatchedAccount(request);
	if (mismatchedAccount) return mismatchedAccount;

	return auth.handler(request);
}
