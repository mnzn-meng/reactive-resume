import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import * as schema from "@reactive-resume/db/schema";
import { jsonPatchOperationSchema } from "@reactive-resume/resume/patch";
import { aiOperationIdsSchema, aiUsageSummarySchema } from "@reactive-resume/schema/ai-usage";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { writableResumeDataSchema } from "@reactive-resume/schema/resume/write";
import { templateSchema } from "@reactive-resume/schema/templates";
import { localeSchema } from "@reactive-resume/utils/locale";
import { paginationShape } from "../pagination";
import { proposalApplicationsSchema, proposalSafetySchema } from "./proposals";

const resumeSchema = createSelectSchema(schema.resume, {
	id: z.string().describe("The ID of the resume."),
	name: z.string().trim().min(1).describe("The name of the resume."),
	tags: z.array(z.string()).describe("The tags of the resume."),
	isLocked: z.boolean().describe("Whether the resume is locked."),
	data: resumeDataSchema,
	userId: z.string().describe("The ID of the user who owns the resume."),
	createdAt: z.date().describe("The date and time the resume was created."),
	updatedAt: z.date().describe("The date and time the resume was last updated."),
})
	// Trash and automatic naming stay internal to the documents API. getById exposes the application link explicitly
	// because the editor uses it to select the application a tailored copy belongs to.
	.omit({ applicationId: true, trashedAt: true, autoName: true, editedAt: true, aiOperationIds: true });

const aiSourceShape = {
	aiOperationIds: aiOperationIdsSchema.optional(),
	aiUsage: aiUsageSummarySchema.nullable().optional(),
};
const ownedResumeSchema = resumeSchema.omit({ userId: true }).extend(aiSourceShape);

const versionSchema = z.object({
	id: z.string().describe("The ID of the version."),
	kind: z
		.enum(schema.RESUME_VERSION_KINDS)
		.describe(
			"What made the version: created, import, auto (an editing session's autosave), named, before-restore, restored, ai (an AI or API edit) or sent.",
		),
	name: z.string().nullable().describe("The user's name for a named version."),
	createdAt: z.date().describe("When this state was saved."),
});

// Writes next to the data (lock, password, linked application) take the revision the caller last saw, and answer
// with the revision they made, so an open editor's next autosave builds on it.
// Coercion would read null as 1970, which every resume fails; a malformed revision is refused before any check.
export const expectedRevisionSchema = z
	.union([z.date(), z.string(), z.number()])
	.pipe(z.coerce.date())
	.optional()
	.describe(
		"If provided, the change only applies when the resume version still matches this timestamp; otherwise RESUME_VERSION_CONFLICT (409).",
	);
export const acceptedRevisionSchema = ownedResumeSchema.describe(
	"The resume as the change left it, with its new updatedAt.",
);

export const resumeDto = {
	list: {
		input: z
			.object({
				...paginationShape,
				tags: z
					.union([z.string().transform((tag) => [tag]), z.array(z.string())])
					.optional()
					.default([]),
				sort: z.enum(["lastUpdatedAt", "createdAt", "name"]).optional().default("lastUpdatedAt"),
			})
			.optional()
			.default({ tags: [], sort: "lastUpdatedAt" }),
		output: z.array(resumeSchema.omit({ data: true, userId: true })),
	},

	getById: {
		input: resumeSchema.pick({ id: true }),
		output: ownedResumeSchema.extend({
			applicationId: z.string().nullable().describe("The job application this resume was made for, if any."),
		}),
	},

	create: {
		input: resumeSchema.pick({ name: true, tags: true }).extend({
			autoName: z
				.boolean()
				.optional()
				.describe("While true, the resume's name follows its headline until someone renames it."),
			withSampleData: z.boolean().default(false),
			locale: localeSchema.optional().describe("The resume language. Uses the interface language when omitted."),
			template: templateSchema
				.optional()
				.describe("The template to start in, such as one chosen in the template gallery. The default when omitted."),
		}),
		output: z.string().describe("The ID of the created resume."),
	},

	import: {
		input: z.object({ data: writableResumeDataSchema, aiOperationIds: aiOperationIdsSchema.optional() }),
		output: z.string().describe("The ID of the imported resume."),
	},

	update: {
		input: resumeSchema
			.pick({ name: true, tags: true, data: true })
			.partial()
			.extend({
				id: z.string(),
				data: writableResumeDataSchema.optional(),
				aiOperationIds: aiOperationIdsSchema.optional(),
				expectedUpdatedAt: z.coerce
					.date()
					.optional()
					.describe("If provided, the update only applies when the resume version still matches this timestamp."),
				proposalApplications: proposalApplicationsSchema,
				proposalSafety: proposalSafetySchema,
				sessionId: z
					.string()
					.max(64)
					.optional()
					.describe(
						"Identifies one editing session. Saves that share it keep one autosave version, refreshed at most every two minutes.",
					),
			}),
		output: ownedResumeSchema,
	},

	setLocked: {
		input: resumeSchema.pick({ id: true, isLocked: true }).extend({ expectedUpdatedAt: expectedRevisionSchema }),
		output: acceptedRevisionSchema,
	},

	patch: {
		input: z.object({
			id: z.string().describe("The ID of the resume to patch."),
			expectedUpdatedAt: z.coerce
				.date()
				.optional()
				.describe("If provided, the patch only applies when the resume version still matches this timestamp."),
			operations: z
				.array(jsonPatchOperationSchema)
				.min(1)
				.describe("An array of JSON Patch (RFC 6902) operations to apply to the resume data."),
			proposalApplications: proposalApplicationsSchema.describe(
				"Assistant edits this patch applies (edit ID: true) or undoes (false). Recorded in the same transaction only when each applied edit's current wording is in the patched resume and tailoring allows it; otherwise nothing is written.",
			),
			proposalSafety: proposalSafetySchema,
		}),
		output: ownedResumeSchema,
	},

	duplicate: {
		input: resumeSchema.pick({ id: true }).extend({
			pageLocale: localeSchema
				.optional()
				.describe("Set the copy's page language without changing the source or translating its text."),
			name: resumeSchema.shape.name.optional(),
			tags: resumeSchema.shape.tags.optional(),
		}),
		output: z.string().describe("The ID of the duplicated resume."),
	},

	delete: {
		input: resumeSchema.pick({ id: true }),
		output: z.void(),
	},

	listVersions: {
		input: z.object({
			...paginationShape,
			resumeId: z.string().describe("The ID of the resume whose version history to list."),
		}),
		output: z.array(versionSchema),
	},

	getVersion: {
		input: z.object({
			resumeId: z.string().describe("The ID of the resume the version belongs to."),
			versionId: z.string().describe("The ID of the version."),
		}),
		output: versionSchema.extend({ data: resumeDataSchema, ...aiSourceShape }),
	},

	createVersion: {
		input: z.object({
			resumeId: z.string().describe("The ID of the resume to name a version of."),
			name: z.string().trim().min(1).max(80).describe("The version's name, e.g. 'Sent to Lumen'."),
		}),
		output: versionSchema,
	},

	renameVersion: {
		input: z.object({
			resumeId: z.string().describe("The ID of the resume the version belongs to."),
			versionId: z.string().describe("The ID of the named version."),
			name: z.string().trim().min(1).max(80).describe("The version's new name."),
		}),
		output: versionSchema,
	},

	deleteVersion: {
		input: z.object({
			resumeId: z.string().describe("The ID of the resume the version belongs to."),
			versionId: z.string().describe("The ID of the named version."),
		}),
		output: z.void(),
	},

	restoreVersion: {
		input: z.object({
			resumeId: z.string().describe("The ID of the resume to restore."),
			versionId: z.string().describe("The ID of the version snapshot to restore."),
			proposalSafety: proposalSafetySchema,
		}),
		output: ownedResumeSchema,
	},
};
