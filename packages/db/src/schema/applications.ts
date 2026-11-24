import type {
	AiMetadata,
	ApplicationClosedReason,
	ApplicationStatus,
	ApplicationTimelineEntry,
	Contact,
	PostingSource,
} from "@zhiye/schema/applications/data";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@zhiye/utils/string";
import { user } from "./auth";
import { resume, resumeVersion } from "./resume";

export const applicationPipeline = pg.pgTable("application_pipeline", {
	userId: pg
		.text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	revision: pg.integer("revision").notNull().default(0),
});

export const applicationLane = pg.pgTable(
	"application_lane",
	{
		id: pg
			.text("id")
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		category: pg.text("category").$type<ApplicationStatus>().notNull(),
		label: pg.text("label"),
		color: pg.text("color").notNull(),
		position: pg.integer("position").notNull(),
		systemKey: pg.text("system_key").$type<ApplicationStatus>(),
		closedReason: pg.text("closed_reason").$type<ApplicationClosedReason>(),
		retiredAt: pg.timestamp("retired_at", { withTimezone: true }),
	},
	(t) => [
		pg.unique("application_lane_owner_id_unique").on(t.userId, t.id),
		pg.unique("application_lane_owner_system_unique").on(t.userId, t.systemKey),
		pg.index().on(t.userId),
	],
);

// A tracked job application. Points at the live resume that was sent (resumeId),
// which is the reason this lives inside the product rather than a generic tracker.
export const application = pg.pgTable(
	"application",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		company: pg.text("company").notNull(),
		role: pg.text("role").notNull(),
		location: pg.text("location"),
		salary: pg.text("salary"),
		// Fixed pipeline stage enum (see applicationStatusSchema); stored as text per repo convention.
		status: pg.text("status").$type<ApplicationStatus>().notNull().default("saved"),
		laneId: pg.text("lane_id"),
		// Why a closed application ended (not selected, withdrew, accepted another offer, no response). Insights use it.
		closedReason: pg.text("closed_reason").$type<ApplicationClosedReason>(),
		// Live link to one of the user's resumes. Kept on resume delete (set null) so the
		// application history survives.
		resumeId: pg.text("resume_id").references(() => resume.id, { onDelete: "set null" }),
		// The linked resume as it was when the application reached Applied, and its Check score then.
		sentResumeVersionId: pg.text("sent_resume_version_id").references(() => resumeVersion.id, { onDelete: "set null" }),
		sentCheckScore: pg.smallint("sent_check_score"),
		source: pg.text("source"),
		tags: pg.text("tags").array().notNull().default([]),
		// --- AI reservations (no working AI this pass; see feature AI roadmap) ---
		sourceUrl: pg.text("source_url"),
		jobDescription: pg.text("job_description"),
		postingSource: pg.jsonb("posting_source").$type<PostingSource>(),
		// The original job posting kept as an uploaded PDF, so it survives the posting changing or disappearing.
		// Stored as the storage URL + original filename for display.
		postingFileUrl: pg.text("posting_file_url"),
		postingFileName: pg.text("posting_file_name"),
		// What the posting asks for, as read from it when the application was added.
		requirements: pg.jsonb("requirements").notNull().$type<string[]>().default([]),
		matchScore: pg.integer("match_score"),
		aiMetadata: pg.jsonb("ai_metadata").$type<AiMetadata>(),
		notes: pg.text("notes"),
		// An uploaded resume file (PDF) sent with this application, distinct from the live
		// resumeId link. Stored as the storage URL + original filename for display.
		resumeFileUrl: pg.text("resume_file_url"),
		resumeFileName: pg.text("resume_file_name"),
		followUpAt: pg.timestamp("follow_up_at", { withTimezone: true }),
		followUpDateOnly: pg.boolean("follow_up_date_only").notNull().default(false),
		followUpNote: pg.text("follow_up_note"),
		contacts: pg.jsonb("contacts").notNull().$type<Contact[]>().default([]),
		activity: pg.jsonb("activity").notNull().$type<ApplicationTimelineEntry[]>().default([]),
		trashedAt: pg.timestamp("trashed_at", { withTimezone: true }),
		appliedAt: pg.timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
		// Durable lifetime submission marker: set on the first sent stage or explicit submit, never cleared by timeline
		// edits. It distinguishes a genuine first submission from reopening a job that was applied earlier.
		submittedAt: pg.timestamp("submitted_at", { withTimezone: true }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [
		pg.index().on(t.userId),
		pg.index().on(t.userId, t.updatedAt.desc()),
		pg.index().on(t.userId, t.trashedAt),
		pg.foreignKey({
			name: "application_lane_owner_fk",
			columns: [t.userId, t.laneId],
			foreignColumns: [applicationLane.userId, applicationLane.id],
		}),
		pg.index().on(t.userId, t.laneId),
		// Deleting a resume or one of its versions looks these up; without an index each lookup reads every
		// application.
		pg.index().on(t.resumeId),
		pg.index().on(t.sentResumeVersionId),
	],
);
