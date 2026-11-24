import { ORPCError } from "@orpc/server";
import { APIError } from "better-auth";
import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import { accountAuth, auth } from "@zhiye/auth/config";
import * as schema from "@zhiye/db/schema";
import { env } from "@zhiye/env/server";
import { applicationProfileRecordSchema } from "@zhiye/schema/application-profile";
import { applicationPipelineSchema } from "@zhiye/schema/applications/lanes";
import {
	careerProfileDataSchema,
	careerWorkspaceDataSchema,
	submissionReviewSchema,
	discoverySourceSchema,
} from "@zhiye/schema/career";
import { accountBackupLimits, accountUploadSkipReasons } from "@zhiye/utils/account-zip";
import { localeSchema } from "@zhiye/utils/locale";
import { timezoneSchema } from "@zhiye/utils/timezone";
import { protectedProcedure, publicProcedure } from "../../context";
import { applicationDto } from "../../dto/application";
import {
	savedItemSchema,
	reviewedAnswerSchema,
	careerFactSchema,
	careerNotificationSchema,
	careerScheduleSchema,
	careerStorySchema,
} from "../../dto/career";
import { resumeDto } from "../../dto/resume";
import { accountRateLimit } from "../../middleware/rate-limit";
import { authService } from "./service";

const accountProcedure = protectedProcedure.use(accountRateLimit).use(async ({ next }) => {
	try {
		return await next();
	} catch (error) {
		if (error instanceof APIError && error.statusCode < 500) {
			throw new ORPCError(error.body?.code ?? "BAD_REQUEST", {
				status: error.statusCode,
				message: error.message,
				cause: error,
			});
		}
		throw error;
	}
});

// Sessions last a week; a key that never expires, or deleting the account, needs a sign-in from the last day.
const RECENT_SIGN_IN_MS = 24 * 60 * 60 * 1000;

async function assertRecentSignIn(headers: Headers | undefined) {
	const session = headers ? await auth.api.getSession({ headers, query: { disableCookieCache: true } }) : null;
	const signedInAt = session ? new Date(session.session.createdAt).getTime() : 0;
	if (Date.now() - signedInAt > RECENT_SIGN_IN_MS)
		throw new ORPCError("FORBIDDEN", { message: "For your security, sign out and sign in again, then try again." });
}

export const authRouter = {
	getProfile: accountProcedure
		.route({
			method: "GET",
			path: "/auth/profile",
			tags: ["Authentication"],
			operationId: "getProfile",
			summary: "Get your profile",
			description:
				"Returns only the authenticated user's profile, timezone and interface language (null until an app reports one). No secrets are included.",
		})
		.input(z.object({}).optional())
		.output(
			createSelectSchema(schema.user)
				.pick({
					id: true,
					name: true,
					username: true,
					displayUsername: true,
					image: true,
					email: true,
					emailVerified: true,
					timezone: true,
				})
				.extend({ locale: localeSchema.nullable() }),
		)
		.handler(({ context }) => authService.getProfile(context.user.id)),

	updateProfile: accountProcedure
		.route({
			method: "PATCH",
			path: "/auth/profile",
			tags: ["Authentication"],
			operationId: "updateProfile",
			summary: "Update your profile",
			description:
				"Updates only the authenticated user's name, username, image, timezone, or interface language. The language picks the language of account emails. Usernames must be unique.",
		})
		.input(
			z.object({
				name: z.string().trim().min(1).max(64).optional(),
				username: z
					.string()
					.trim()
					.min(3)
					.max(64)
					.regex(/^[a-z0-9._-]+$/)
					.optional(),
				image: z.url().nullable().optional(),
				timezone: timezoneSchema.optional(),
				locale: localeSchema.optional(),
			}),
		)
		.output(z.object({ status: z.boolean() }))
		.handler(({ context, input }) =>
			accountAuth.updateProfile(context.user, {
				...(input.name !== undefined ? { name: input.name } : {}),
				...(input.username !== undefined ? { username: input.username } : {}),
				...(input.image !== undefined ? { image: input.image } : {}),
				...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
				...(input.locale !== undefined ? { locale: input.locale } : {}),
			}),
		),

	providers: {
		list: publicProcedure
			.route({
				method: "GET",
				path: "/auth/providers",
				tags: ["Authentication"],
				operationId: "listAuthProviders",
				summary: "List authentication providers",
				description:
					"Returns a list of all authentication providers enabled on this 职页 instance, along with their display names. Possible providers include password-based credentials, Apple, Google, GitHub, LinkedIn, and custom OAuth. No authentication required.",
				successDescription: "A map of enabled authentication provider identifiers to their display names.",
			})
			.input(z.object({}).optional())
			.output(
				z.partialRecord(
					z.enum(["credential", "passkey", "apple", "google", "github", "linkedin", "custom"]),
					z.string(),
				),
			)
			.handler(() => authService.providers.list()),
	},

	setPassword: accountProcedure
		.route({
			// Session only: keys and OAuth tokens can't add a password.
			spec: (operation) => ({ ...operation, security: [{ cookieAuth: [] }] }),
			method: "POST",
			path: "/auth/password",
			tags: ["Authentication"],
			operationId: "setPassword",
			summary: "Set a password",
			description:
				"Adds a password to an account that signs in another way (a social account or passkey). Unlike a password reset, it keeps other devices signed in and keeps passkeys. Requires a recent browser session.",
		})
		.input(z.object({ newPassword: z.string().min(8).max(64) }))
		.output(z.void())
		.handler(async ({ context, input }) => {
			if (env.FLAG_DISABLE_EMAIL_AUTH)
				throw new ORPCError("FORBIDDEN", { message: "Password sign-in is turned off on this server." });
			await assertRecentSignIn(context.reqHeaders);
			await auth.api.setPassword({
				body: { newPassword: input.newPassword },
				headers: context.reqHeaders ?? new Headers(),
			});
		}),

	exportData: protectedProcedure
		.use(accountRateLimit)
		.route({
			method: "GET",
			path: "/auth/account/export",
			tags: ["Authentication"],
			operationId: "exportAccountData",
			summary: "Export user account data",
			description:
				"Returns the authenticated user's profile, documents and version histories, applications, Career records and feedback. Set includeUploads to include bounded base64 bytes for files referenced by exported records, with explicit omissions; external URLs are not fetched. Secrets such as password hashes, tokens and API keys are never included.",
			successDescription: "The user's exported account data.",
		})
		.input(z.object({ includeUploads: z.union([z.boolean(), z.literal("")]).optional() }).optional())
		.output(
			z.object({
				exportedAt: z.string(),
				uploads: z
					.object({
						files: z
							.array(
								z.object({ key: z.string(), base64: z.string().max(Math.ceil(accountBackupLimits.fileBytes / 3) * 4) }),
							)
							.max(accountBackupLimits.files),
						skipped: z.array(z.object({ key: z.string(), reason: z.enum(accountUploadSkipReasons) })),
					})
					.optional(),
				applicationProfile: applicationProfileRecordSchema.nullable().optional(),
				user: createSelectSchema(schema.user).pick({
					id: true,
					name: true,
					email: true,
					username: true,
					displayUsername: true,
					image: true,
					timezone: true,
					locale: true,
					emailVerified: true,
					createdAt: true,
					updatedAt: true,
				}),
				resumes: z.array(resumeDto.getById.output.omit({ applicationId: true })),
				documentVersions: z
					.object({
						// Preserve historical JSON verbatim; current document parsing can normalize old snapshots.
						resumes: z.array(
							createSelectSchema(schema.resumeVersion, { data: z.record(z.string(), z.unknown()) }).omit({
								userId: true,
							}),
						),
					})
					.optional(),
				applications: z.array(
					applicationDto.getById.output.extend({
						submittedAt: z
							.date()
							.nullable()
							.describe(
								"First recorded submission time, retained after later stage changes; null when no submission is recorded.",
							),
					}),
				),
				applicationPipeline: applicationPipelineSchema,
				aiContentReports: z.array(createSelectSchema(schema.aiContentReport)),
				career: z.object({
					aiRequests: z.array(createSelectSchema(schema.aiRequest).omit({ userId: true })).optional(),
					writingReviews: z
						.array(
							createSelectSchema(schema.resumeWritingReview, {
								passages: z.array(z.object({ id: z.string(), where: z.string(), text: z.string() })).nullable(),
								review: z.record(z.string(), z.unknown()).nullable(),
							}).omit({ userId: true, requestGeneration: true }),
						)
						.optional(),
					profile: careerProfileDataSchema,
					reviewedAnswers: z.array(reviewedAnswerSchema),
					facts: z.array(careerFactSchema.omit({ usedBy: true, company: true })),
					stories: z.array(careerStorySchema),
					artifacts: z.array(savedItemSchema),
					schedules: z.array(careerScheduleSchema),
					notifications: z.array(careerNotificationSchema),
					threads: z.array(createSelectSchema(schema.agentThread)),
					messages: z.array(
						createSelectSchema(schema.agentMessage, {
							// Preserve historical SDK/tool message fields in their original export form.
							uiMessage: z.record(z.string(), z.unknown()),
						}),
					),
					attachments: z.array(createSelectSchema(schema.agentAttachment)),
					opportunities: z.array(
						createSelectSchema(schema.careerOpportunity, { discoverySource: discoverySourceSchema.nullable() }),
					),
					jobs: z.array(createSelectSchema(schema.careerJob)),
					transcripts: z.array(createSelectSchema(schema.careerTranscript)),
					workspaces: z.array(
						createSelectSchema(schema.careerWorkspace, {
							data: careerWorkspaceDataSchema,
							submissionReview: submissionReviewSchema.nullable(),
						}),
					),
				}),
				feedback: z
					.object({
						links: z.array(
							createSelectSchema(schema.feedbackLink, { snapshot: z.record(z.string(), z.unknown()) }).omit({
								userId: true,
							}),
						),
						comments: z.array(createSelectSchema(schema.feedbackComment).omit({ userId: true })),
						events: z.array(createSelectSchema(schema.feedbackEvent).omit({ userId: true })),
					})
					.optional(),
			}),
		)
		.handler(({ context, input, signal }) => {
			const bindings = [context.reqHeaders.get("x-account-id"), context.rpcItemAccountId];
			if (bindings.some((id) => id && id !== context.user.id))
				throw new ORPCError("CONFLICT", { message: "This export belongs to another account. Reload and try again." });
			return authService.exportData({
				userId: context.user.id,
				includeUploads: input?.includeUploads === true,
				signal,
			});
		}),

	deleteAccount: protectedProcedure
		.route({
			spec: (operation) => ({ ...operation, security: [{ cookieAuth: [] }] }),
			method: "DELETE",
			path: "/auth/account",
			tags: ["Authentication"],
			operationId: "deleteAccount",
			summary: "Delete user account",
			description:
				"Permanently deletes the authenticated user's account, including all resumes, uploaded files (profile pictures, screenshots, PDFs), and associated data. This action is irreversible. Requires a recent browser session.",
			successDescription: "The user account and all associated data have been successfully deleted.",
		})
		.input(z.object({}).optional())
		.output(z.void())
		.handler(async ({ context }) => {
			await assertRecentSignIn(context.reqHeaders);
			await authService.deleteAccount({ userId: context.user.id });
		}),
};
