import type { ResumeData } from "@zhiye/schema/resume/data";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { defaultResumeData } from "@zhiye/schema/resume/default";
import { generateId } from "@zhiye/utils/string";
import { application } from "./applications";
import { user } from "./auth";

export const resume = pg.pgTable(
	"resume",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		name: pg.text("name").notNull(),
		tags: pg.text("tags").array().notNull().default([]),
		// Private request lineage stays outside portable resume data.
		aiOperationIds: pg.text("ai_operation_ids").array().notNull().default([]),
		isLocked: pg.boolean("is_locked").notNull().default(false),
		// "Made for this application": Check's job match, the assistant and Copy for a job use its posting.
		// Separate from application.resume_id, the resume linked to (or sent with) an application.
		applicationId: pg.text("application_id").references((): AnyPgColumn => application.id, { onDelete: "set null" }),
		// In Trash since this moment; purged after 30 days. Trashed resumes are hidden and not shared.
		trashedAt: pg.timestamp("trashed_at", { withTimezone: true }),
		// A blank resume's name follows its headline until the user renames it.
		autoName: pg.boolean("auto_name").notNull().default(false),
		data: pg
			.jsonb("data")
			.notNull()
			.$type<ResumeData>()
			.$defaultFn(() => defaultResumeData),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
		// When the content (`data`) last changed, for "Last edited". Existing documents were backfilled from
		// `updated_at` (the time the library already showed); metadata writes move only `updated_at`, the concurrency
		// check, and stay out of this. A trigger in the migration keeps this one current on every write path.
		editedAt: pg.timestamp("edited_at", { withTimezone: true }).defaultNow(),
	},
	(t) => [
		pg.index().on(t.createdAt.asc()),
		pg.index().on(t.userId, t.updatedAt.desc()),
		// Finds documents past Trash retention without scanning every resume.
		pg
			.index()
			.on(t.trashedAt)
			.where(sql`${t.trashedAt} is not null`),
		// Looked up when the row it points to is deleted.
		pg.index().on(t.applicationId),
	],
);

/**
 * What made a version: created or imported (the first entry), an editing session's autosave, a version the
 * user named, the state saved before a restore, the restore itself, an AI edit, or a sent application.
 */
export const RESUME_VERSION_KINDS = [
	"created",
	"import",
	"auto",
	"named",
	"before-restore",
	"restored",
	"ai",
	"sent",
] as const;

export type ResumeVersionKind = (typeof RESUME_VERSION_KINDS)[number];

export const resumeVersion = pg.pgTable(
	"resume_version",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		resumeId: pg
			.text("resume_id")
			.notNull()
			.references(() => resume.id, { onDelete: "cascade" }),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// Snapshot of the resume data. A session's autosave is refreshed while the session lasts; the rest are immutable.
		data: pg.jsonb("data").notNull().$type<ResumeData>(),
		aiOperationIds: pg.text("ai_operation_ids").array().notNull().default([]),
		kind: pg.text("kind", { enum: RESUME_VERSION_KINDS }).notNull().default("auto"),
		// The user's name for a `named` version.
		name: pg.text("name"),
		// The editing session an `auto` version belongs to (one row per session).
		sessionId: pg.text("session_id"),
		// When this state was saved (a session's autosave moves forward as the session goes on).
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		pg.index().on(t.resumeId, t.createdAt.desc()),
		pg
			.uniqueIndex("resume_version_session_unique")
			.on(t.resumeId, t.sessionId)
			.where(sql`${t.kind} = 'auto'`),
		// Looked up when the row it points to is deleted.
		pg.index().on(t.userId),
	],
);

/** One paid writing review per resume, kept independently of the editable document revision. */
export const resumeWritingReview = pg.pgTable("resume_writing_review", {
	resumeId: pg
		.text("resume_id")
		.primaryKey()
		.references(() => resume.id, { onDelete: "cascade" }),
	userId: pg
		.text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	requestGeneration: pg.integer("request_generation").notNull().default(1),
	inputText: pg.text("input_text"),
	passages: pg.jsonb("passages").$type<{ id: string; where: string; text: string }[]>(),
	review: pg.jsonb("review").$type<Record<string, unknown>>(),
	aiOperationId: pg.text("ai_operation_id"),
	requestedAt: pg.timestamp("requested_at", { withTimezone: true }),
	reviewedAt: pg.timestamp("reviewed_at", { withTimezone: true }),
});
