import type { User } from "better-auth";
import type { AnonymousOptions, GenericOAuthConfig, GenericOAuthUserInfo } from "better-auth/plugins";
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { dash } from "@better-auth/infra";
import { passkey } from "@better-auth/passkey";
import { compare, hash } from "bcryptjs";
import { APIError, betterAuth } from "better-auth";
import { addOAuthServerContext, createAuthMiddleware, getOAuthState, isAPIError } from "better-auth/api";
import { deleteSessionCookie, parseCookies, setSessionCookie } from "better-auth/cookies";
import { admin, anonymous, jwt, openAPI } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { username } from "better-auth/plugins/username";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { createDefaultOwnedApplicationLanes, MAX_APPLICATION_LANES } from "@reactive-resume/db/application-lanes";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import {
	confirmNewEmail,
	resetPasswordEmail,
	verifyEmail,
	verifyEmailChange,
} from "@reactive-resume/email/templates/auth";
import { sendEmail } from "@reactive-resume/email/transport";
import { env } from "@reactive-resume/env/server";
import { defaultLocale, isLocale, localeSchema } from "@reactive-resume/utils/locale";
import { rateLimitConfig } from "@reactive-resume/utils/rate-limit";
import { generateId, toUsername } from "@reactive-resume/utils/string";
import { timezoneSchema } from "@reactive-resume/utils/timezone";
import {
	allocateUniqueUsername,
	createGithubProfileMapper,
	createProfileMapper,
	isUsernameReserved,
} from "./oauth-profile";
import { authRateLimitStorage } from "./rate-limit";
import { getTrustedOrigins } from "./trusted-origins";

/** Better Auth's verification tokens carry `updateTo` when they move the account to a new address. */
export function isEmailChangeToken(token: string): boolean {
	try {
		const payload = token.split(".")[1];
		if (!payload) return false;
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { updateTo?: unknown };
		return typeof claims.updateTo === "string" && claims.updateTo.length > 0;
	} catch {
		return false;
	}
}

const authBaseUrl = env.APP_URL;

/** The interface language a request was made in: the app keeps it in the `locale` cookie. */
function requestLocale(headers: Headers | undefined) {
	const locale = parseCookies(headers?.get("cookie") ?? "").get("locale");
	return isLocale(locale) ? locale : undefined;
}

/**
 * Account emails use the account's language, then the language of the request that sent them (an account from before
 * the app stored one), then English. Only the text changes: the link, its expiry and who receives it don't.
 */
function accountEmailLocale(user: User, request: Request | undefined) {
	const saved = (user as User & { locale?: unknown }).locale;
	return isLocale(saved) ? saved : (requestLocale(request?.headers) ?? defaultLocale);
}
const isRateLimitEnabled = process.env.NODE_ENV === "production" && !env.FLAG_DISABLE_API_RATE_LIMIT;

export function isCustomOAuthProviderEnabled() {
	const hasDiscovery = Boolean(env.OAUTH_DISCOVERY_URL);
	const hasManual =
		Boolean(env.OAUTH_AUTHORIZATION_URL) && Boolean(env.OAUTH_TOKEN_URL) && Boolean(env.OAUTH_USER_INFO_URL);

	return Boolean(env.OAUTH_CLIENT_ID) && Boolean(env.OAUTH_CLIENT_SECRET) && (hasDiscovery || hasManual);
}

const TRUSTED_ORIGINS = getTrustedOrigins(env.APP_URL);
const accountUser = new AsyncLocalStorage<User>();
// Better Auth 1.7 types generic-OAuth profile extras as `unknown`.
function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** Prepare external resources before commit; optional cleanup runs only after commit. */
export type AccountLinkHook = (params: {
	fromUserId: string;
	toUserId: string;
	excludedStoragePrefixes: string[];
}) => Promise<(() => Promise<void>) | void>;

let accountLinkHook: AccountLinkHook | undefined;

/** Sets the one account-link hook; no argument clears it. */
export function setAccountLinkHook(hook?: AccountLinkHook): void {
	accountLinkHook = hook;
}

export async function linkAnonymousAccount({
	fromUserId,
	toUserId,
}: {
	fromUserId: string;
	toUserId: string;
}): Promise<void> {
	if (fromUserId === toUserId) return;

	const cleanup = await db.transaction(async (tx) => {
		// Match document/application writers' owner-first order; stable order prevents opposing-link deadlocks.
		for (const userId of [fromUserId, toUserId].sort()) {
			const [owner] = await tx
				.select({ id: schema.user.id })
				.from(schema.user)
				.where(eq(schema.user.id, userId))
				.for("no key update");
			if (!owner) throw new APIError("NOT_FOUND", { message: "The account is unavailable." });
		}

		const careerProfiles = await tx
			.select()
			.from(schema.careerProfile)
			.where(inArray(schema.careerProfile.userId, [fromUserId, toUserId]));
		const guestCareerProfile = careerProfiles.find((profile) => profile.userId === fromUserId);
		const accountCareerProfile = careerProfiles.find((profile) => profile.userId === toUserId);
		// Neither authored preferences nor memory consent can be silently replaced during sign-in.
		if (
			guestCareerProfile &&
			accountCareerProfile &&
			!isDeepStrictEqual(guestCareerProfile.data, accountCareerProfile.data)
		)
			throw new APIError("CONFLICT", {
				message:
					"Guest and account Career preferences differ. Your guest work is unchanged. Match Career preferences and Knowledge memory settings in both accounts before trying again.",
			});

		const profiles = await tx
			.select()
			.from(schema.applicationProfile)
			.where(inArray(schema.applicationProfile.userId, [fromUserId, toUserId]));
		const sourceProfile = profiles.find((profile) => profile.userId === fromUserId);
		if (sourceProfile && profiles.some((profile) => profile.userId === toUserId))
			throw new APIError("CONFLICT", {
				message:
					"Both accounts have a private application profile. Export and delete one profile in Settings → Account before linking, so neither is silently overwritten.",
			});
		if (sourceProfile)
			await tx
				.update(schema.applicationProfile)
				.set({ userId: toUserId, revision: generateId() })
				.where(eq(schema.applicationProfile.userId, fromUserId));
		const sourceLanes = await tx
			.select()
			.from(schema.applicationLane)
			.where(eq(schema.applicationLane.userId, fromUserId));
		const targetLanes = await tx
			.select()
			.from(schema.applicationLane)
			.where(eq(schema.applicationLane.userId, toUserId));
		const defaultLanes = createDefaultOwnedApplicationLanes(toUserId);
		const targetActiveCount = targetLanes.length
			? targetLanes.filter((lane) => !lane.retiredAt).length
			: defaultLanes.length;
		if (
			targetActiveCount + sourceLanes.filter((lane) => !lane.systemKey && !lane.retiredAt).length >
			MAX_APPLICATION_LANES
		)
			throw new APIError("CONFLICT", {
				message:
					"Retire unused application lanes before combining these accounts; the combined pipeline exceeds 40 active lanes.",
			});
		await tx.insert(schema.applicationPipeline).values({ userId: toUserId }).onConflictDoNothing();
		await tx.insert(schema.applicationLane).values(defaultLanes).onConflictDoNothing();
		const laneIds = new Map<string, string>();
		let position = Math.max(5, ...targetLanes.map((lane) => lane.position)) + 1;
		for (const lane of sourceLanes) {
			const id = lane.systemKey
				? (targetLanes.find((target) => target.systemKey === lane.systemKey)?.id ??
					`application-lane:${toUserId}:${lane.systemKey}`)
				: generateId();
			laneIds.set(lane.id, id);
			if (!lane.systemKey)
				await tx.insert(schema.applicationLane).values({ ...lane, id, userId: toUserId, position: position++ });
		}
		await tx
			.update(schema.applicationPipeline)
			.set({ revision: sql`${schema.applicationPipeline.revision} + 1` })
			.where(eq(schema.applicationPipeline.userId, toUserId));

		const rewriteUploadsJson = (column: unknown) =>
			sql`cast(replace(cast(${column} as text), 'uploads/' || ${fromUserId} || '/', 'uploads/' || ${toUserId} || '/') as jsonb)`;

		const rewriteUploadsUrl = (column: unknown) =>
			sql`case when ${column} is not null then replace(${column}, 'uploads/' || ${fromUserId} || '/', 'uploads/' || ${toUserId} || '/') else null end`;

		// The guest's resumes move to the target account, and their picture paths follow.
		await tx
			.update(schema.resume)
			.set({ userId: toUserId, data: rewriteUploadsJson(schema.resume.data) })
			.where(eq(schema.resume.userId, fromUserId));

		await tx
			.update(schema.resumeVersion)
			.set({
				userId: toUserId,
				data: rewriteUploadsJson(schema.resumeVersion.data),
			})
			.where(eq(schema.resumeVersion.userId, fromUserId));

		const applications = await tx
			.select()
			.from(schema.application)
			.where(eq(schema.application.userId, fromUserId))
			.for("update");
		for (const application of applications) {
			await tx
				.update(schema.application)
				.set({
					userId: toUserId,
					laneId: application.laneId
						? (laneIds.get(application.laneId) ?? `application-lane:${toUserId}:${application.status}`)
						: `application-lane:${toUserId}:${application.status}`,
					activity: application.activity.map((entry) =>
						entry.type === "stage" && entry.laneId && laneIds.has(entry.laneId)
							? { ...entry, laneId: laneIds.get(entry.laneId) ?? entry.laneId }
							: entry,
					),
					resumeFileUrl: rewriteUploadsUrl(schema.application.resumeFileUrl),
					postingFileUrl: rewriteUploadsUrl(schema.application.postingFileUrl),
				})
				.where(and(eq(schema.application.id, application.id), eq(schema.application.userId, fromUserId)));
		}

		// A guest fact the account already holds stays behind and is deleted with the guest, so moved work cites the
		// account's copy. Fact ids are UUIDs: replacing their quoted form changes nothing else.
		const facts = await tx
			.select({ id: schema.careerFact.id, userId: schema.careerFact.userId, sourceKey: schema.careerFact.sourceKey })
			.from(schema.careerFact)
			.where(inArray(schema.careerFact.userId, [fromUserId, toUserId]));
		const accountFacts = new Map(
			facts.filter((fact) => fact.userId === toUserId).map((fact) => [fact.sourceKey, fact.id]),
		);
		const citeAccountFacts = (column: unknown) =>
			sql`cast(${facts.reduce(
				(text, fact) => {
					const accountFact = fact.userId === fromUserId && accountFacts.get(fact.sourceKey);
					return accountFact ? sql`replace(${text}, ${`"${fact.id}"`}, ${`"${accountFact}"`})` : text;
				},
				sql`cast(${column} as text)`,
			)} as jsonb)`;

		// Moved answers and documents cite these by operation id, and saving them checks the account owns each one.
		await tx.update(schema.aiRequest).set({ userId: toUserId }).where(eq(schema.aiRequest.userId, fromUserId));

		await tx
			.update(schema.careerWorkspace)
			.set({
				userId: toUserId,
				data: citeAccountFacts(schema.careerWorkspace.data),
				updatedAt: schema.careerWorkspace.updatedAt,
			})
			.where(eq(schema.careerWorkspace.userId, fromUserId));

		await tx
			.update(schema.careerArtifact)
			.set({
				userId: toUserId,
				data: citeAccountFacts(schema.careerArtifact.data),
				evidence: citeAccountFacts(schema.careerArtifact.evidence),
				updatedAt: schema.careerArtifact.updatedAt,
			})
			.where(eq(schema.careerArtifact.userId, fromUserId));

		await tx
			.update(schema.careerTranscript)
			.set({ userId: toUserId, updatedAt: schema.careerTranscript.updatedAt })
			.where(eq(schema.careerTranscript.userId, fromUserId));

		const sourceAnswers = await tx.select().from(schema.careerAnswer).where(eq(schema.careerAnswer.userId, fromUserId));
		const targetAnswers = await tx.select().from(schema.careerAnswer).where(eq(schema.careerAnswer.userId, toUserId));
		if (sourceAnswers.some((answer) => targetAnswers.some((target) => target.duplicateKey === answer.duplicateKey)))
			throw new APIError("CONFLICT", {
				message:
					"Both accounts have duplicate saved application answers. Export and delete one copy before linking, so neither is silently overwritten.",
			});
		// Preserve wording; the Knowledge facts the answers cite move with them below.
		await tx
			.update(schema.careerAnswer)
			.set({
				userId: toUserId,
				factIds: citeAccountFacts(schema.careerAnswer.factIds),
				evidence: citeAccountFacts(schema.careerAnswer.evidence),
				updatedAt: schema.careerAnswer.updatedAt,
			})
			.where(eq(schema.careerAnswer.userId, fromUserId));

		// The guest was invited to build Knowledge like any user: facts, stories and the career profile move too. A fact
		// the account already holds from the same source stays the account's; the guest's copy goes with the guest.
		// Saved answers' evidence revisions include fact and story timestamps, so the moves keep them.
		await tx
			.update(schema.careerFact)
			.set({ userId: toUserId, updatedAt: schema.careerFact.updatedAt })
			.where(
				and(
					eq(schema.careerFact.userId, fromUserId),
					sql`not exists (select 1 from career_fact f where f.user_id = ${toUserId} and f.source_key = career_fact.source_key)`,
				),
			);
		await tx
			.update(schema.careerStory)
			.set({
				userId: toUserId,
				data: citeAccountFacts(schema.careerStory.data),
				updatedAt: schema.careerStory.updatedAt,
			})
			.where(eq(schema.careerStory.userId, fromUserId));
		await tx
			.update(schema.careerProfile)
			.set({ userId: toUserId })
			.where(
				and(
					eq(schema.careerProfile.userId, fromUserId),
					sql`not exists (select 1 from career_profile p where p.user_id = ${toUserId})`,
				),
			);

		// Feedback links move with their resumes, so links already sent keep working and their comments stay together.
		await tx
			.update(schema.feedbackLink)
			.set({ userId: toUserId, snapshot: rewriteUploadsJson(schema.feedbackLink.snapshot) })
			.where(eq(schema.feedbackLink.userId, fromUserId));
		await tx
			.update(schema.feedbackComment)
			.set({ userId: toUserId })
			.where(eq(schema.feedbackComment.userId, fromUserId));
		await tx.update(schema.feedbackEvent).set({ userId: toUserId }).where(eq(schema.feedbackEvent.userId, fromUserId));

		// Ownership updates lock document rows, so guest saves cannot add uncopied references during copying.
		const hook = accountLinkHook;
		if (!hook) return;
		const erasures = await tx
			.select({ storageKey: schema.storageCleanupJob.storageKey })
			.from(schema.storageCleanupJob)
			.where(eq(schema.storageCleanupJob.ownerId, fromUserId));
		return hook({ fromUserId, toUserId, excludedStoragePrefixes: erasures.map(({ storageKey }) => storageKey) });
	});

	try {
		await cleanup?.();
	} catch (error) {
		console.warn("Failed to clean up linked account resources:", error);
	}
}

type GuestLink = Parameters<NonNullable<AnonymousOptions["onLinkAccount"]>>[0];

async function moveGuestWork({ anonymousUser, newUser, ctx }: GuestLink): Promise<void> {
	try {
		await linkAnonymousAccount({
			fromUserId: anonymousUser.user.id,
			toUserId: newUser.user.id,
		});
	} catch (error) {
		// Better Auth sets the new session cookie before this runs. A failed transfer must leave the
		// guest accessible, and must not expose a usable credential-session cookie on the error reply.
		deleteSessionCookie(ctx);
		await setSessionCookie(ctx, anonymousUser, undefined, {
			maxAge: Math.max(0, Math.floor((anonymousUser.session.expiresAt.getTime() - Date.now()) / 1000)),
		});
		await ctx.context.internalAdapter.deleteSession(newUser.session.token).catch(() => {});
		if (isAPIError(error)) throw error;
		// Better Auth keeps these cookies only on an APIError reply; any other error drops them.
		console.error("Failed to move guest work to account %s:", newUser.user.id, error);
		throw new APIError("INTERNAL_SERVER_ERROR", {
			message: "The guest work could not be moved to this account. Try again.",
		});
	}
}

const getAuthConfig = () => {
	const authConfigs: GenericOAuthConfig[] = [];

	if (isCustomOAuthProviderEnabled()) {
		authConfigs.push({
			providerId: "custom",
			disableSignUp: env.FLAG_DISABLE_SIGNUPS,
			clientId: env.OAUTH_CLIENT_ID as string,
			clientSecret: env.OAUTH_CLIENT_SECRET as string,
			discoveryUrl: env.OAUTH_DISCOVERY_URL,
			authorizationUrl: env.OAUTH_AUTHORIZATION_URL,
			tokenUrl: env.OAUTH_TOKEN_URL,
			userInfoUrl: env.OAUTH_USER_INFO_URL,
			scopes: env.OAUTH_SCOPES,
			// Better Auth 1.7 folds generic OAuth providers into `socialProviders`, so the callback
			// is served by `/callback/:id` — the old `/oauth2/callback/:id` route no longer exists.
			redirectURI: `${authBaseUrl}/api/auth/callback/custom`,
			mapProfileToUser: createProfileMapper<GenericOAuthUserInfo>({
				providerName: "OAuth Provider",
				getPreferredUsername: (profile, context) => asString(profile.preferred_username) ?? context.emailLocalPart,
				getName: (profile, context) =>
					asString(profile.name) ?? asString(profile.preferred_username) ?? context.emailLocalPart,
				getImage: (profile) => asString(profile.image) ?? asString(profile.picture) ?? asString(profile.avatar_url),
			}),
		} satisfies GenericOAuthConfig);
	}

	return betterAuth({
		appName: "职页",
		baseURL: authBaseUrl,
		secret: env.AUTH_SECRET,

		database: drizzleAdapter(db, { schema, provider: "pg" }),

		telemetry: { enabled: false },
		trustedOrigins: [
			...TRUSTED_ORIGINS,
			// Apple's form_post callback includes this origin; keep CSRF checks enabled.
			...(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET ? ["https://appleid.apple.com"] : []),
		],
		rateLimit: {
			...rateLimitConfig.betterAuth.global,
			...(authRateLimitStorage ? { customStorage: authRateLimitStorage } : {}),
			enabled: isRateLimitEnabled,
		},

		databaseHooks: {
			user: {
				create: {
					before: async (user, context) => {
						// New accounts inherit the device timezone from the auth request, so interview times,
						// reminders and schedules are right from the first use. Social callbacks don't carry the
						// header; the sign-in hook stores the validated zone in the signed OAuth state.
						const fromHeader = timezoneSchema.safeParse(context?.headers?.get("x-client-timezone"));
						// Direct calls outside an auth request have no OAuth state to read.
						const oauthState = context ? await getOAuthState().catch(() => null) : null;
						const fromOAuth = timezoneSchema.safeParse(oauthState?.serverContext?.timezone);
						const timezone = fromHeader.success ? fromHeader.data : fromOAuth.success ? fromOAuth.data : undefined;
						// The interface language the account was made in, for its first emails. Like the timezone, a social
						// sign-up reads it from the OAuth state, because a cross-site callback may arrive without cookies.
						const fromOAuthLocale = oauthState?.serverContext?.locale;
						const locale = requestLocale(context?.headers) ?? (isLocale(fromOAuthLocale) ? fromOAuthLocale : undefined);
						const data = { ...user, ...(timezone ? { timezone } : {}), ...(locale ? { locale } : {}) };
						if (!user.isAnonymous) return timezone || locale ? { data } : undefined;

						// Guests sign in without a username. The tail of a UUIDv7 is random; its head is a timestamp.
						const username = `guest-${generateId().slice(-12)}`;
						return { data: { ...data, username, displayUsername: username } };
					},
				},
			},
		},

		// Unused endpoints: guest deletion skips the app's storage cleanup; the session JWT has no consumer.
		disabledPaths: ["/delete-anonymous-user", "/token"],

		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path === "/sign-in/social") {
					const timezone = timezoneSchema.safeParse(ctx.headers?.get("x-client-timezone"));
					// Keep the device timezone across the provider redirect in server-only state, so the
					// callback can start a new account there without trusting redirect parameters.
					const locale = requestLocale(ctx.headers);
					if (timezone.success || locale)
						await addOAuthServerContext({
							...(timezone.success ? { timezone: timezone.data } : {}),
							...(locale ? { locale } : {}),
						});
				}

				if (ctx.path === "/sign-up/email" && ctx.body && typeof ctx.body.email === "string") {
					// The username is optional at sign-up: an empty one is made from the email address, changeable in Settings.
					const chosen = [ctx.body.username, ctx.body.displayUsername].some(
						(value: unknown) => typeof value === "string" && value.trim(),
					);
					if (!chosen) {
						const username = await allocateUniqueUsername(ctx.body.email);
						ctx.body.username = username;
						ctx.body.displayUsername = username;
					}
				}

				const user = accountUser.getStore();
				// Sign-up copies displayUsername into username when username is missing, so either one claims the name.
				const requestedUsername: unknown = ctx.body?.username ?? ctx.body?.displayUsername;
				if (
					typeof requestedUsername === "string" &&
					["/sign-up/email", "/update-user", "/is-username-available"].includes(ctx.path)
				) {
					const claimant =
						user?.id ??
						(ctx.path === "/update-user"
							? (await auth.api.getSession({ headers: ctx.headers ?? new Headers() }))?.user.id
							: undefined);
					if (await isUsernameReserved(toUsername(requestedUsername), claimant))
						throw new APIError("UNPROCESSABLE_ENTITY", {
							code: "USERNAME_IS_ALREADY_TAKEN",
							message: "This username is already taken. Choose another.",
						});
				}
				if (user && !ctx.request && ctx.path === "/update-user") {
					// Internal account calls reuse session-only hooks without creating a browser credential.
					return {
						context: {
							context: {
								session: {
									user,
									session: {
										id: "",
										token: "",
										userId: user.id,
										createdAt: new Date(0),
										updatedAt: new Date(0),
										expiresAt: new Date(0),
									},
								},
							},
						},
					};
				}
				if (ctx.path === "/sign-in/anonymous" && (!env.FLAG_ENABLE_GUEST_LOGIN || env.FLAG_DISABLE_SIGNUPS)) {
					throw new APIError("FORBIDDEN", {
						message: "Guest access is turned off on this server. Create an account or sign in.",
					});
				}
				if (ctx.path === "/verify-email") {
					// A verification link signs in as its account, and the anonymous plugin would then move the
					// guest's documents into it, even when the link belongs to someone else.
					const current = await auth.api.getSession({ headers: ctx.headers ?? new Headers() });
					if (current?.user.isAnonymous) {
						throw new APIError("FORBIDDEN", {
							message: "Sign out of the guest session before verifying an email address.",
						});
					}
					return;
				}
				if (ctx.path === "/sign-in/username" && env.FLAG_DISABLE_EMAIL_AUTH)
					throw new APIError("FORBIDDEN", { message: "Password sign-in is turned off on this server." });
				if (["/passkey/generate-register-options", "/passkey/verify-registration"].includes(ctx.path)) {
					// freshAge is 0 so old sessions can unlink providers; adding a passkey still needs a recent sign-in.
					const current = await auth.api.getSession({
						headers: ctx.headers ?? new Headers(),
						query: { disableCookieCache: true },
					});
					if (!current) throw new APIError("UNAUTHORIZED");
					if (ctx.path.startsWith("/passkey/") && !current.user.emailVerified)
						throw new APIError("FORBIDDEN", { message: "Verify your email address before adding a passkey." });
					const age = Date.now() - new Date(current.session.createdAt).getTime();
					if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) {
						throw new APIError("FORBIDDEN", { message: "For your security, sign in again to add a credential." });
					}
					return;
				}
			}),
		},

		// Keeps sign-in failures on the app's own page instead of Better Auth's built-in one.
		onAPIError: { errorURL: "/auth/error" },

		advanced: {
			database: { generateId, joins: true },
			useSecureCookies: authBaseUrl.startsWith("https://"),
			ipAddress: { ipAddressHeaders: ["X-Real-IP"] },
		},

		emailAndPassword: {
			enabled: !env.FLAG_DISABLE_EMAIL_AUTH,
			autoSignIn: true,
			minPasswordLength: 8,
			maxPasswordLength: 64,
			requireEmailVerification: false,
			// The reset email says the link works for 1 hour; keep this in step with it.
			resetPasswordTokenExpiresIn: 60 * 60,
			disableSignUp: env.FLAG_DISABLE_SIGNUPS || env.FLAG_DISABLE_EMAIL_AUTH,
			sendResetPassword: async ({ user, url }, request) => {
				await sendEmail({ to: user.email, ...resetPasswordEmail({ url, locale: accountEmailLocale(user, request) }) });
			},
			revokeSessionsOnPasswordReset: true,
			// The reset link proved control of the inbox. Drop credentials someone else may hold, such as on an
			// account registered with this address before its owner.
			onPasswordReset: async ({ user }) => {
				await db.transaction(async (tx) => {
					// Historical passkeys may predate mailbox verification; recovery revokes all of them.
					await tx.delete(schema.passkey).where(eq(schema.passkey.userId, user.id));
					// Nobody had proved this address before: whoever signed up with it may have added other ways in.
					if (!user.emailVerified) {
						await tx
							.delete(schema.account)
							.where(and(eq(schema.account.userId, user.id), ne(schema.account.providerId, "credential")));
					}
					await tx.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, user.id));
				});
			},
			password: {
				hash: (password) => hash(password, 10),
				verify: ({ password, hash }) => compare(password, hash),
			},
		},

		emailVerification: {
			sendOnSignUp: true,
			autoSignInAfterVerification: true,
			// The emails say the link works for 1 hour; keep this in step with them.
			expiresIn: 60 * 60,
			sendVerificationEmail: async ({ user, url, token }, request) => {
				const locale = accountEmailLocale(user, request);
				// A token that moves the account to another address is an email change, not a sign-up: say so.
				const email = isEmailChangeToken(token) ? confirmNewEmail({ url, locale }) : verifyEmail({ url, locale });
				await sendEmail({ to: user.email, ...email });
			},
		},

		user: {
			changeEmail: {
				enabled: true,
				// Better Auth's two-step change: the current address approves first, then the new address gets its own
				// verification link. Sending this step to the new address would let anyone holding a session move the
				// account to an address they control without the owner's approval.
				sendChangeEmailConfirmation: async ({ user, newEmail, url }, request) => {
					const locale = accountEmailLocale(user, request);
					await sendEmail({
						to: user.email,
						...verifyEmailChange({ url, previousEmail: user.email, newEmail, locale }),
					});
				},
			},
			additionalFields: {
				username: {
					type: "string",
					required: true,
				},
				timezone: {
					type: "string",
					required: false,
					defaultValue: "UTC",
					validator: { input: timezoneSchema },
				},
				locale: {
					type: "string",
					required: false,
					validator: { input: localeSchema },
				},
			},
		},

		// Better Auth gates `/unlink-account` (and `/list-sessions`) behind a "fresh"
		// session, which defaults to one day old. Sessions here live for a week and
		// there is no re-authentication flow to refresh that timestamp, so disconnecting
		// a provider failed with `SESSION_NOT_FRESH` for anyone who signed in yesterday.
		session: { freshAge: 0 },

		account: {
			// Linking by email needs the provider to report that email as verified.
			accountLinking: { enabled: true },
			encryptOAuthTokens: true,
		},

		socialProviders: {
			apple: {
				enabled: !!env.APPLE_CLIENT_ID && !!env.APPLE_CLIENT_SECRET,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
				clientId: env.APPLE_CLIENT_ID ?? "",
				clientSecret: env.APPLE_CLIENT_SECRET ?? "",
				mapProfileToUser: createProfileMapper({
					providerName: "Apple",
					getName: (profile, context) => profile.name || context.emailLocalPart,
				}),
			},

			google: {
				enabled: !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
				clientId: env.GOOGLE_CLIENT_ID ?? "",
				clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
				mapProfileToUser: createProfileMapper({
					providerName: "Google",
					getName: (profile, context) => profile.name ?? context.emailLocalPart,
					getImage: (profile) => profile.picture,
				}),
			},

			github: {
				enabled: !!env.GITHUB_CLIENT_ID && !!env.GITHUB_CLIENT_SECRET,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
				clientId: env.GITHUB_CLIENT_ID ?? "",
				clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
				mapProfileToUser: createGithubProfileMapper(),
			},

			linkedin: {
				enabled: !!env.LINKEDIN_CLIENT_ID && !!env.LINKEDIN_CLIENT_SECRET,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
				clientId: env.LINKEDIN_CLIENT_ID ?? "",
				clientSecret: env.LINKEDIN_CLIENT_SECRET ?? "",
				mapProfileToUser: createProfileMapper({
					providerName: "LinkedIn",
					getName: (profile, context) => profile.name ?? context.emailLocalPart,
					getImage: (profile) => profile.picture,
				}),
			},
		},

		plugins: [
			// JSON schema only; no reference-page inline scripts need a CSP nonce.
			openAPI({ disableDefaultReference: true }),
			jwt({ disableSettingJwtHeader: true }),
			admin(),
			passkey(),
			genericOAuth({ config: authConfigs }),
			username({
				minUsernameLength: 3,
				maxUsernameLength: 64,
				usernameNormalization: (value) => toUsername(value),
				displayUsernameNormalization: (value) => toUsername(value),
				usernameValidator: (username) => /^[a-z0-9._-]+$/.test(username),
				validationOrder: { username: "post-normalization", displayUsername: "post-normalization" },
			}),
			anonymous({
				emailDomainName: "reactive-resume.local",
				generateName: () => "Guest",
				// Signing up or in from a guest session moves the guest's documents to that account; the plugin then
				// deletes the guest account, along with anything not moved here (assistant threads, career data).
				onLinkAccount: moveGuestWork,
			}),
			...(env.BETTER_AUTH_API_KEY
				? [dash({ apiKey: env.BETTER_AUTH_API_KEY, activityTracking: { enabled: true } })]
				: []),
		],
	});
};

type Auth = ReturnType<typeof getAuthConfig>;

let authInstance: Auth | undefined;

function getAuthInstance(): Auth {
	if (authInstance) return authInstance;

	const instance = getAuthConfig();
	authInstance = instance;
	// A rejected Better Auth context cannot recover. Let the next request rebuild it.
	void instance.$context.catch(() => {
		if (authInstance === instance) authInstance = undefined;
	});
	return instance;
}

// Keep initialization inside a request or explicit deployment preparation, not module evaluation.
export const auth: Auth = new Proxy({} as Auth, {
	get(_target, property) {
		const instance = getAuthInstance();
		return Reflect.get(instance, property, instance);
	},
});

type ProfileUpdate = { name?: string; username?: string; image?: string | null; timezone?: string; locale?: string };

// Only these server calls can install the identity; their cookie headers never leave this module.
export const accountAuth = {
	updateProfile: (user: User, body: ProfileUpdate) =>
		accountUser.run(user, () =>
			auth.api.updateUser({
				body: { ...body, ...(body.username !== undefined ? { displayUsername: body.username } : {}) },
			}),
		),
};

export async function initializeAuth(): Promise<void> {
	await auth.$context;
}
