import { call } from "@orpc/server";
import z from "zod";
import { protectedProcedure } from "../context";
import { documentExports, documentRenders } from "../features/documents/exports";
import { checkResume, checkPdf, matchResume } from "../features/resume/checks";
import { importResumeFile, previewPdfImport } from "../features/resume/imports";
import { uploadFileOutputSchema } from "../features/storage/router";
import router from "./index";

// Add resource-oriented aliases without changing the routes existing clients use.
export const restAliases = {
	documentExports,
	documentRenders,
	checkResume,
	checkPdf,
	matchResume,
	importResumeFile,
	previewPdfImport,
	updateApplication: router.applications.update.route({ method: "PATCH", operationId: "patchApplication" }),
	updateInterview: router.applications.updateInterview.route({
		method: "PATCH",
		operationId: "patchApplicationInterview",
	}),
	updateTimelineEntry: router.applications.updateTimelineEntry.route({
		method: "PATCH",
		operationId: "patchApplicationTimelineEntry",
	}),
	updateResume: router.resume.update.route({
		method: "PATCH",
		path: "/resumes/{id}/metadata",
		operationId: "patchResumeMetadata",
	}),
	resumeCopy: router.resume.duplicate.route({ path: "/resumes/{id}/copies", operationId: "createResumeCopy" }),
	resumeImport: router.resume.import.route({ path: "/resumes/imports", operationId: "createResumeImport" }),
	resumeLock: router.resume.setLocked.route({
		method: "PUT",
		path: "/resumes/{id}/lock",
		operationId: "putResumeLock",
	}),
	resumeRestoration: router.resume.restoreVersion.route({
		path: "/resumes/{resumeId}/versions/{versionId}/restorations",
		operationId: "createResumeRestoration",
	}),
	documentName: router.documents.rename.route({
		method: "PATCH",
		path: "/documents/{id}/name",
		operationId: "patchDocumentName",
	}),
	documentTags: router.documents.setTags.route({
		method: "PUT",
		path: "/documents/{id}/tags",
		operationId: "putDocumentTags",
	}),
	documentLock: router.documents.setLocked.route({
		method: "PUT",
		path: "/documents/{id}/lock",
		operationId: "putDocumentLock",
	}),
	documentApplication: router.documents.linkApplication.route({
		method: "PUT",
		path: "/documents/{id}/application",
		operationId: "putDocumentApplication",
	}),
	documentTrash: router.documents.trash.route({
		method: "PUT",
		path: "/documents/{id}/trash",
		operationId: "putDocumentTrash",
	}),
	documentRestore: router.documents.restore.route({
		method: "DELETE",
		path: "/documents/{id}/trash",
		operationId: "deleteDocumentTrash",
	}),
	documentPurge: router.documents.purge.route({
		method: "DELETE",
		path: "/documents/{id}",
		operationId: "deleteDocumentPermanently",
	}),
	documentCopy: router.documents.copyForJob.route({ path: "/documents/copies", operationId: "createDocumentCopy" }),
	postingSearch: router.applications.ai.searchPostings.route({
		path: "/applications/ai/posting-searches",
		operationId: "createPostingSearch",
	}),
	postingParse: router.applications.ai.parsePosting.route({
		path: "/applications/ai/posting-parses",
		operationId: "createPostingParse",
	}),
	applicationAutofill: router.applications.ai.autofill.route({
		path: "/applications/ai/autofills",
		operationId: "createApplicationAutofill",
	}),
	applicationMatch: router.applications.ai.matchScore.route({
		path: "/applications/{id}/ai/match-scores",
		operationId: "createApplicationMatchScore",
	}),
	applicationMessage: router.applications.ai.draftMessage.route({
		path: "/applications/{id}/ai/message-drafts",
		operationId: "createApplicationMessageDraft",
	}),
	applicationResume: router.applications.ai.tailorResume.route({
		path: "/applications/{id}/ai/tailored-resumes",
		operationId: "createTailoredResume",
	}),
	applicationImport: router.applications.import.route({
		path: "/applications/imports",
		operationId: "createApplicationImport",
	}),
	applicationBulkUpdate: router.applications.bulkUpdate.route({
		method: "PATCH",
		path: "/applications",
		operationId: "patchApplications",
	}),
	applicationBulkDelete: router.applications.bulkDelete.route({
		method: "DELETE",
		path: "/applications",
		operationId: "deleteApplications",
	}),
	providerTest: router.aiProviders.test.route({
		path: "/ai-providers/{id}/tests",
		operationId: "createAiProviderTest",
	}),
	webAccessTest: router.webAccess.test.route({
		path: "/integrations/web-access/tests",
		operationId: "createWebAccessTest",
	}),
	message: router.agent.messages.send.route({
		path: "/agent/threads/{threadId}/messages",
		operationId: "createAgentMessage",
	}),
	messageStop: router.agent.messages.stop.route({
		method: "DELETE",
		path: "/agent/threads/{threadId}/run",
		operationId: "deleteAgentRun",
	}),
	messageStream: router.agent.messages.resume.route({
		path: "/agent/threads/{threadId}/stream",
		operationId: "getAgentStream",
	}),
	messageEdits: router.agent.messages.setEditStatus.route({
		method: "PATCH",
		path: "/agent/threads/{threadId}/messages/{messageId}/edits",
		operationId: "patchAgentMessageEdits",
	}),
	pdfParsing: router.ai.parsePdf.route({ path: "/ai/pdf-parses", operationId: "createPdfParse" }),
	docxParsing: router.ai.parseDocx.route({ path: "/ai/docx-parses", operationId: "createDocxParse" }),
	atsReview: router.ai.atsReview.route({ path: "/ai/ats-reviews", operationId: "createAtsReview" }),
	improvement: router.ai.improve.route({ path: "/ai/improvements", operationId: "createImprovement" }),
	fileUpload: protectedProcedure
		.route({
			method: "POST",
			path: "/files",
			tags: ["Files"],
			operationId: "createFile",
			summary: "Upload a file",
			description:
				"Send a multipart form with a file field (maximum 10 MiB). Images become public profile pictures; other files remain owner-only. Requires authentication.",
		})
		.input(z.object({ file: z.file().max(10 * 1024 * 1024) }))
		.output(uploadFileOutputSchema)
		.handler(({ input, context }) => call(router.storage.uploadFile, input.file, { context })),
	fileDelete: router.storage.deleteFile.route({
		method: "DELETE",
		path: "/files",
		tags: ["Files"],
		operationId: "deleteStoredFile",
	}),
};
