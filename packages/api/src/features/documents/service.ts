import type { EditableFields } from "../../dto/application";
import type { DocumentFilters } from "../../dto/documents";
import type { DbOrTx } from "@zhiye/db/client";
import { ORPCError } from "@orpc/client";
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "@zhiye/db/client";
import * as schema from "@zhiye/db/schema";
import { activeApplications } from "../applications/access";
import { applicationService, insertApplication } from "../applications/service";
import { notifyResumeUpdated, resumeService, writeResumeFields } from "../resume/service";
import { listDocumentPage, listDocuments } from "./listing";
import { isRetriedCreate, lockUser, recordCreateRequest } from "./ownership";

type DocumentRef = { userId: string; id: string };
type DocumentSelection = Pick<DocumentRef, "id">;

// Trash keeps documents this long before deleting them for good.
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** "{source} · {company}" for a copy made for a job, "{source} (copy)" without one. Older copies used " — ". */
function suggestCopyName(sourceName: string, company?: string) {
	const base = sourceName.split(/ [·—] /)[0]?.trim() || sourceName;
	return (company ? `${base} · ${company}` : `${base} (copy)`).slice(0, 100);
}

async function assertOwnedApplication(userId: string, applicationId: string, reader: DbOrTx = db) {
	const [application] = await reader
		.select({
			id: schema.application.id,
			company: schema.application.company,
			resumeId: schema.application.resumeId,
			status: schema.application.status,
			sentResumeVersionId: schema.application.sentResumeVersionId,
		})
		.from(schema.application)
		.where(and(eq(schema.application.id, applicationId), activeApplications(userId)));

	if (!application)
		throw new ORPCError("NOT_FOUND", { message: "This application no longer exists. Choose another application." });
	return application;
}

/** A resume's row, scoped to its owner. */
const owned = ({ id, userId }: DocumentRef) => and(eq(schema.resume.id, id), eq(schema.resume.userId, userId));

type ResumeChanges = Partial<typeof schema.resume.$inferInsert>;

async function update(ref: DocumentRef, changes: ResumeChanges) {
	const updatedAt = await db.transaction(async (tx) => {
		await lockUser(tx, ref.userId);
		if (changes.applicationId) await assertOwnedApplication(ref.userId, changes.applicationId, tx);
		const [row] = await tx
			.update(schema.resume)
			.set(changes)
			.where(owned(ref))
			.returning({ updatedAt: schema.resume.updatedAt });
		if (!row) throw new ORPCError("NOT_FOUND");
		return row.updatedAt;
	});
	// After commit, like every other resume write: an open editor reads the resume again and builds on this revision.
	await notifyResumeUpdated({
		type: "resume.updated",
		resumeId: ref.id,
		userId: ref.userId,
		updatedAt: updatedAt.toISOString(),
		mutation: "update",
	});
}

async function readState(ref: DocumentRef) {
	const [row] = await db
		.select({ isLocked: schema.resume.isLocked, trashedAt: schema.resume.trashedAt })
		.from(schema.resume)
		.where(owned(ref));

	if (!row) throw new ORPCError("NOT_FOUND");
	return row;
}

async function assertUnlocked(ref: DocumentRef) {
	const state = await readState(ref);
	if (state.isLocked) throw new ORPCError("RESUME_LOCKED", { status: 403 });
	return state;
}

/**
 * Deletes for good through the resume's own path, storage included. With `trashedBefore` (Trash expiry), only a
 * document still in Trash since then goes, whether or not it's locked.
 */
const deleteForGood = (ref: DocumentRef, trashedBefore?: Date) =>
	resumeService.delete({ id: ref.id, userId: ref.userId, ...(trashedBefore ? { trashedBefore } : {}) });

/** One account's documents trashed more than 30 days ago go for good; runs when the account lists its documents. */
async function purgeExpired(userId: string) {
	const cutoff = new Date(Date.now() - TRASH_RETENTION_MS);
	const resumes = await db
		.select({ id: schema.resume.id })
		.from(schema.resume)
		.where(and(eq(schema.resume.userId, userId), lt(schema.resume.trashedAt, cutoff)));

	await Promise.allSettled(resumes.map(({ id }) => deleteForGood({ userId, id }, cutoff)));
}

/**
 * Trash keeps documents for 30 days, as the app promises, even for accounts that never come back: each scheduler tick
 * deletes a batch of expired documents across all accounts.
 */
async function purgeExpiredTrash(limit = 50) {
	const cutoff = new Date(Date.now() - TRASH_RETENTION_MS);
	const resumes = await db
		.select({ id: schema.resume.id, userId: schema.resume.userId })
		.from(schema.resume)
		.where(lt(schema.resume.trashedAt, cutoff))
		.orderBy(asc(schema.resume.trashedAt))
		.limit(limit);

	await Promise.allSettled(resumes.map(({ id, userId }) => deleteForGood({ userId, id }, cutoff)));
}

export const documentsService = {
	purgeExpired,
	purgeExpiredTrash,

	list: async (
		input: DocumentFilters & { userId: string; limit?: number | undefined; offset?: number | undefined },
	) => {
		// Legacy complete Trash reads retain their cleanup side effect. Bounded reads leave cleanup to the scheduler.
		if (input.trashed && input.limit === undefined && input.offset === undefined)
			await purgeExpired(input.userId).catch((error: unknown) =>
				console.error("[documents] Trash purge failed", error),
			);
		return listDocuments(input);
	},
	page: (input: DocumentFilters & { userId: string; limit: number; offset: number }) => listDocumentPage(input),

	counts: async (input: { userId: string }) => {
		const recent = new Date(Date.now() - TRASH_RETENTION_MS);
		const [[active], [trash]] = await Promise.all([
			db
				.select({ total: count() })
				.from(schema.resume)
				.where(and(eq(schema.resume.userId, input.userId), isNull(schema.resume.trashedAt))),
			db
				.select({ total: count() })
				.from(schema.resume)
				.where(and(eq(schema.resume.userId, input.userId), gte(schema.resume.trashedAt, recent))),
		]);

		return { active: active?.total ?? 0, trash: trash?.total ?? 0 };
	},

	/** A name typed by hand ends a blank resume's automatic naming. Locked documents keep their details. */
	rename: async (input: DocumentRef & { name: string }) => {
		await assertUnlocked(input);
		await update(input, { name: input.name, autoName: false });
	},

	setTags: async (input: DocumentRef & { tags: string[] }) => {
		await assertUnlocked(input);
		await update(input, { tags: [...new Set(input.tags)] });
	},

	setLocked: async (input: DocumentRef & { isLocked: boolean }) => {
		await resumeService.setLocked({ id: input.id, userId: input.userId, isLocked: input.isLocked });
	},

	linkApplication: async (
		input: DocumentRef & { applicationId: string | null; expectedUpdatedAt?: Date | undefined },
	) => {
		await assertUnlocked(input);
		const application = input.applicationId ? await assertOwnedApplication(input.userId, input.applicationId) : null;
		// Detaching must not leave the application pointing at a document it no longer holds, so read the old link first.
		const previousApplicationId = input.applicationId
			? null
			: ((
					await db
						.select({ applicationId: schema.resume.applicationId })
						.from(schema.resume)
						.where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)))
						.limit(1)
				)[0]?.applicationId ?? null);
		// Answers with the resume's new revision, so the open editor's next autosave builds on it. The account lock
		// comes first, then the resume, then the application: the order every document and application write takes.
		const resume = await writeResumeFields({
			id: input.id,
			userId: input.userId,
			set: { applicationId: input.applicationId },
			unlockedOnly: true,
			expectedUpdatedAt: input.expectedUpdatedAt,
			mutation: "update",
			before: async (tx) => {
				await lockUser(tx, input.userId);
				if (input.applicationId) await assertOwnedApplication(input.userId, input.applicationId, tx);
			},
		});
		if (application && !application.sentResumeVersionId && (!application.resumeId || application.status === "saved"))
			await applicationService.update({ userId: input.userId, id: application.id, resumeId: input.id });
		if (previousApplicationId)
			await db
				.update(schema.application)
				.set({ resumeId: null })
				.where(and(eq(schema.application.id, previousApplicationId), eq(schema.application.resumeId, input.id)));
		return resume;
	},

	/** Undoable: Trash hides the document; Restore brings it back intact. */
	trash: async (input: DocumentRef) => {
		await assertUnlocked(input);
		await update(input, { trashedAt: new Date() });
	},

	restore: (input: DocumentRef) => update(input, { trashedAt: null }),

	/**
	 * Restores the selected loaded documents in one transaction. Only this account's documents that are still in Trash
	 * are touched; a document restored or deleted by another request is skipped instead of failing the batch.
	 */
	restoreMany: async (input: { userId: string; documents: DocumentSelection[] }) => {
		const ids = [...new Set(input.documents.map(({ id }) => id))];
		const resumes = await db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			return ids.length === 0
				? []
				: await tx
						.update(schema.resume)
						.set({ trashedAt: null })
						.where(
							and(
								eq(schema.resume.userId, input.userId),
								inArray(schema.resume.id, ids),
								isNotNull(schema.resume.trashedAt),
							),
						)
						.returning({ id: schema.resume.id, updatedAt: schema.resume.updatedAt });
		});
		// After commit, one event per restored resume, in batches: a selection can be thousands of documents.
		const chunkSize = 100;
		for (let start = 0; start < resumes.length; start += chunkSize) {
			await Promise.allSettled(
				resumes.slice(start, start + chunkSize).map((resume) =>
					notifyResumeUpdated({
						type: "resume.updated",
						resumeId: resume.id,
						userId: input.userId,
						updatedAt: resume.updatedAt.toISOString(),
						mutation: "update",
					}),
				),
			);
		}
		return { restored: resumes.length };
	},

	/**
	 * "Delete permanently" for the selected loaded documents. Only this account's documents still in Trash when the
	 * request runs are deleted, so a concurrent restore wins. Anything else counts as skipped rather than failing.
	 */
	purgeMany: async (input: { userId: string; documents: DocumentSelection[] }) => {
		const ids = [...new Set(input.documents.map(({ id }) => id))];
		const deleted =
			ids.length === 0
				? 0
				: await resumeService.deleteTrashedMany({
						userId: input.userId,
						ids,
						trashedBefore: new Date(),
					});
		return { deleted, skipped: input.documents.length - deleted };
	},

	/**
	 * Empty Trash: deletes every one of this account's trashed documents server-side, not the IDs the client has
	 * loaded. Active documents and other accounts' Trash are untouched, and a concurrent restore wins.
	 */
	emptyTrash: async (input: { userId: string }) => {
		const deleted = await resumeService.deleteTrashedMany({
			userId: input.userId,
			trashedBefore: new Date(),
		});
		return { deleted };
	},

	/** "Delete now…": only for documents already in Trash. */
	purge: async (input: DocumentRef) => {
		const state = await readState(input);
		if (!state.trashedAt) throw new ORPCError("BAD_REQUEST", { message: "Move the document to Trash first." });
		// A concurrent restore wins; Trash deletes don't need a lock because deleting is the point of being there.
		await deleteForGood(input, new Date());
	},

	/**
	 * Duplicates a resume for a job, selecting the working copy while preserving submitted versions. A new job given
	 * with it is saved in the copy's transaction, so there is never a job without its copy or a copy without its job.
	 * With `newId`, a retry (a lost response, a second press, a remounted screen) returns the copy already made.
	 */
	copyForJob: async (input: {
		userId: string;
		resumeId: string;
		applicationId?: string | undefined;
		application?: (EditableFields & { company: string; role: string }) | undefined;
		name?: string | undefined;
		newId?: string | undefined;
	}) => {
		if (input.applicationId && input.application)
			throw new ORPCError("BAD_REQUEST", { message: "Give an existing job or a new one, not both." });

		const application = input.applicationId ? await assertOwnedApplication(input.userId, input.applicationId) : null;
		const { userId, resumeId, applicationId, application: newJob, name, newId } = input;
		// What this copy is for: a retry must ask for the same, so a reused ID never returns or links another resume.
		const created = newId && {
			table: "resume" as const,
			id: newId,
			userId,
			request: { operation: "documents.copyForJob", resumeId, applicationId, application: newJob, name },
		};
		let retried = Boolean(created && (await isRetriedCreate(db, created)));
		let id = retried && created ? created.id : undefined;
		if (!id) {
			const source = await resumeService.getById({ id: resumeId, userId });
			try {
				id = await resumeService.create({
					...(created ? { id: created.id } : {}),
					userId,
					name: name ?? suggestCopyName(source.name, application?.company ?? newJob?.company),
					tags: source.tags,
					locale: source.data.metadata.page.locale as never,
					data: source.data,
					aiOperationIds: source.aiOperationIds,
					...(created || newJob
						? {
								inTransaction: async (tx, copyId) => {
									if (created) await recordCreateRequest(tx, created);
									if (!newJob) return;
									const jobId = await insertApplication(tx, { userId, fields: { ...newJob, resumeId: copyId } });
									await tx.update(schema.resume).set({ applicationId: jobId }).where(eq(schema.resume.id, copyId));
									if (created)
										await tx
											.update(schema.createRequest)
											.set({ applicationId: jobId })
											.where(eq(schema.createRequest.id, copyId));
								},
							}
						: {}),
				});
			} catch (error) {
				// Two presses at once: the first made the copy, the second returns it.
				if (!created || !(await isRetriedCreate(db, created))) throw error;
				id = created.id;
				retried = true;
			}
		}

		const [copy] = retried
			? await db
					.select({ applicationId: schema.resume.applicationId })
					.from(schema.resume)
					.where(eq(schema.resume.id, id))
			: [];
		// The job saved with this copy is part of what the request made: if it has since been deleted or unlinked, a retry
		// is refused rather than saving the job again.
		if (retried && newJob) {
			const [receipt] = await db
				.select({ applicationId: schema.createRequest.applicationId })
				.from(schema.createRequest)
				.where(and(eq(schema.createRequest.id, id), eq(schema.createRequest.userId, userId)));
			const [liveJob] = receipt?.applicationId
				? await db
						.select({ id: schema.application.id })
						.from(schema.application)
						.where(and(eq(schema.application.id, receipt.applicationId), activeApplications(userId)))
				: [];
			if (!liveJob || !receipt?.applicationId || receipt.applicationId !== copy?.applicationId)
				throw new ORPCError("CONFLICT", {
					message: "The job saved with this copy has since been deleted, unlinked or changed.",
				});
		}

		// A retry completes only links the first attempt didn't finish; a link the user has changed since stays.
		if (application) {
			const jobUnchanged = !application.resumeId || application.resumeId === resumeId;
			if (!retried || (!copy?.applicationId && (jobUnchanged || application.resumeId === id)))
				await update({ userId, id }, { applicationId: application.id });
			const linkable = !application.sentResumeVersionId && (!application.resumeId || application.status === "saved");
			if (linkable && application.resumeId !== id && (!retried || jobUnchanged))
				await applicationService.update({ userId, id: application.id, resumeId: id });
		}

		return id;
	},
};
