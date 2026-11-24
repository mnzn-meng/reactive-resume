import type { AuthProvider } from "@zhiye/auth/types";
import { ORPCError } from "@orpc/client";
import { symmetricDecrypt } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { auth, isCustomOAuthProviderEnabled } from "@zhiye/auth/config";
import { db } from "@zhiye/db/client";
import * as schema from "@zhiye/db/schema";
import { env } from "@zhiye/env/server";
import { isLocale } from "@zhiye/utils/locale";
import { applicationProfileService } from "../application-profile/service";
import { applicationLaneService } from "../applications/lanes";
import { careerService } from "../career/service";
import { feedbackService } from "../feedback/service";
import { reportStorageCleanupSummary, runStorageCleanup } from "../storage/cleanup";
import { revokeAppleAuthorization } from "./apple-revocation";
import { exportAccountUploads } from "./export-uploads";

type ProviderList = Partial<Record<AuthProvider, string>>;

const providers = {
	list: (): ProviderList => {
		const providers: ProviderList = { credential: "Password", passkey: "Passkey" };

		if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) providers.apple = "Apple";
		if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.google = "Google";
		if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) providers.github = "GitHub";
		if (env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) providers.linkedin = "LinkedIn";
		if (isCustomOAuthProviderEnabled()) providers.custom = env.OAUTH_PROVIDER_NAME ?? "Custom OAuth";

		return providers;
	},
};

export const authService = {
	providers,
	getProfile: async (userId: string) => {
		const [user] = await db
			.select({
				id: schema.user.id,
				name: schema.user.name,
				username: schema.user.username,
				displayUsername: schema.user.displayUsername,
				image: schema.user.image,
				email: schema.user.email,
				emailVerified: schema.user.emailVerified,
				timezone: schema.user.timezone,
				locale: schema.user.locale,
			})
			.from(schema.user)
			.where(eq(schema.user.id, userId));
		if (!user) throw new ORPCError("NOT_FOUND");
		// A value outside the supported list (none is written, but the column is free text) reads as unknown.
		return { ...user, locale: isLocale(user.locale) ? user.locale : null };
	},

	// GDPR-style export of everything the user owns. Selects explicit columns so
	// secrets (password hashes, tokens, api keys) never leak into the export.
	exportData: async (input: {
		userId: string;
		includeUploads?: boolean | undefined;
		signal?: AbortSignal | undefined;
	}) => {
		input.signal?.throwIfAborted();
		const [userRecord] = await db
			.select({
				id: schema.user.id,
				name: schema.user.name,
				email: schema.user.email,
				username: schema.user.username,
				displayUsername: schema.user.displayUsername,
				image: schema.user.image,
				timezone: schema.user.timezone,
				locale: schema.user.locale,
				emailVerified: schema.user.emailVerified,
				createdAt: schema.user.createdAt,
				updatedAt: schema.user.updatedAt,
			})
			.from(schema.user)
			.where(eq(schema.user.id, input.userId));

		if (!userRecord) throw new ORPCError("NOT_FOUND");

		const resumes = await db
			.select({
				id: schema.resume.id,
				name: schema.resume.name,
				tags: schema.resume.tags,
				data: schema.resume.data,
				aiOperationIds: schema.resume.aiOperationIds,
				isLocked: schema.resume.isLocked,
				createdAt: schema.resume.createdAt,
				updatedAt: schema.resume.updatedAt,
			})
			.from(schema.resume)
			.where(eq(schema.resume.userId, input.userId));

		const applications = await db.select().from(schema.application).where(eq(schema.application.userId, input.userId));
		const resumeVersions = await db
			.select()
			.from(schema.resumeVersion)
			.where(eq(schema.resumeVersion.userId, input.userId));
		const result = {
			exportedAt: new Date().toISOString(),
			user: userRecord,
			resumes,
			applicationPipeline: await applicationLaneService.get(input.userId),
			applications: applications.map(({ userId: _userId, ...application }) => application),
			documentVersions: {
				resumes: resumeVersions.map(({ userId: _owner, ...version }) => version),
			},
			aiContentReports: await db
				.select()
				.from(schema.aiContentReport)
				.where(eq(schema.aiContentReport.userId, input.userId)),
			// This existing backup section carries AI conversations; older archive clients preserve new fields here.
			career: {
				...(await careerService.exportData(input.userId)),
				aiRequests: await db
					.select({
						id: schema.aiRequest.id,
						operationId: schema.aiRequest.operationId,
						action: schema.aiRequest.action,
						providerId: schema.aiRequest.providerId,
						label: schema.aiRequest.label,
						provider: schema.aiRequest.provider,
						model: schema.aiRequest.model,
						createdAt: schema.aiRequest.createdAt,
					})
					.from(schema.aiRequest)
					.where(eq(schema.aiRequest.userId, input.userId)),
				writingReviews: await db
					.select({
						resumeId: schema.resumeWritingReview.resumeId,
						inputText: schema.resumeWritingReview.inputText,
						passages: schema.resumeWritingReview.passages,
						review: schema.resumeWritingReview.review,
						requestedAt: schema.resumeWritingReview.requestedAt,
						reviewedAt: schema.resumeWritingReview.reviewedAt,
						aiOperationId: schema.resumeWritingReview.aiOperationId,
					})
					.from(schema.resumeWritingReview)
					.where(eq(schema.resumeWritingReview.userId, input.userId)),
			},
			applicationProfile: await applicationProfileService.get(input.userId),
			feedback: await feedbackService.exportData(input.userId),
		};
		return {
			...result,
			...(input.includeUploads ? { uploads: await exportAccountUploads(input.userId, result, input.signal) } : {}),
		};
	},

	deleteAccount: async (input: { userId: string }): Promise<void> => {
		const appleAccounts = await db
			.select({ refreshToken: schema.account.refreshToken, accessToken: schema.account.accessToken })
			.from(schema.account)
			.where(and(eq(schema.account.userId, input.userId), eq(schema.account.providerId, "apple")));
		// Provider tokens are stored encrypted; rows written before that stay plaintext and fail to decrypt.
		const { secretConfig: key } = await auth.$context;
		const readToken = async (token: string | null) =>
			token && (await symmetricDecrypt({ key, data: token }).catch(() => token));
		for (const tokens of appleAccounts) {
			const plaintext = {
				refreshToken: await readToken(tokens.refreshToken),
				accessToken: await readToken(tokens.accessToken),
			};
			if (!(await revokeAppleAuthorization(plaintext))) {
				console.warn(
					"Apple authorization revocation unavailable during account deletion; manual revocation instructions apply.",
				);
			}
		}

		try {
			// A database trigger enqueues one account-prefix cleanup row in this same delete transaction, so storage
			// failures cannot leave files without a durable retry target. The row has no user FK and survives deletion.
			await db.delete(schema.user).where(eq(schema.user.id, input.userId));
		} catch (err) {
			console.error("Failed to delete user record:", err);

			throw new ORPCError("INTERNAL_SERVER_ERROR");
		}

		await runStorageCleanup({ ownerId: input.userId, limit: 1 })
			.then(reportStorageCleanupSummary)
			.catch((error: unknown) => console.warn("Account storage cleanup will retry from its durable job.", error));
	},
};
