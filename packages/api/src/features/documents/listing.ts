import type { DocumentFilters, DocumentSummary } from "../../dto/documents";
import type { DbOrTx } from "@zhiye/db/client";
import type { SQLWrapper } from "drizzle-orm";
import { and, arrayContains, asc, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@zhiye/db/client";
import { application, resume } from "@zhiye/db/schema";

type ListInput = DocumentFilters & { userId: string; limit?: number | undefined; offset?: number | undefined };

// One projection and predicate for rows, counts and pages. Never select resume data.
function library(database: DbOrTx, input: ListInput) {
	// PostgreSQL current_timestamp stays fixed throughout the repeatable-read transaction.
	const cutoff = sql`current_timestamp - interval '30 days'`;
	return database
		.select({
			id: resume.id,
			name: resume.name,
			tags: resume.tags,
			isLocked: resume.isLocked,
			trashedAt: resume.trashedAt,
			createdAt: resume.createdAt,
			updatedAt: resume.updatedAt,
			// The migration backfills existing documents from updated_at; coalesce only covers a row that slipped in null.
			editedAt: sql<Date>`coalesce(${resume.editedAt}, ${resume.updatedAt})`.mapWith(resume.updatedAt).as("edited_at"),
			applicationId: sql<string | null>`${application.id}`.as("application_id"),
			company: application.company,
			role: application.role,
			status: application.status,
		})
		.from(resume)
		.leftJoin(
			application,
			and(
				eq(resume.applicationId, application.id),
				and(eq(application.userId, input.userId), isNull(application.trashedAt)),
			),
		)
		.where(
			and(eq(resume.userId, input.userId), input.trashed ? gte(resume.trashedAt, cutoff) : isNull(resume.trashedAt)),
		)
		.as("documents");
}

function predicate(rows: ReturnType<typeof library>, input: ListInput) {
	const q = input.q.trim();
	// strpos treats %, _ and backslashes literally, matching the existing substring search.
	const contains = (value: SQLWrapper) => sql`strpos(lower(${value}), lower(${q})) > 0`;
	return and(
		input.tags.length ? arrayContains(rows.tags, input.tags) : undefined,
		q
			? or(
					contains(rows.name),
					contains(rows.company),
					contains(rows.role),
					sql`exists (select 1 from unnest(${rows.tags}) tag where strpos(lower(tag), lower(${q})) > 0)`,
				)
			: undefined,
	);
}

async function readDocuments(database: DbOrTx, input: ListInput) {
	const rows = library(database, input);
	const where = predicate(rows, input);
	const order =
		input.sort === "name"
			? asc(sql`lower(${rows.name})`)
			: desc(input.sort === "created" ? rows.createdAt : rows.editedAt);
	const query = database.select().from(rows).where(where).orderBy(order, asc(rows.id)).$dynamic();
	const paginated = input.limit !== undefined || input.offset !== undefined;
	const items = await (paginated ? query.limit(input.limit ?? 20).offset(input.offset ?? 0) : query);
	const totals = paginated
		? await database
				.select({ total: sql<number>`count(*)::int` })
				.from(rows)
				.where(where)
		: undefined;
	return {
		items: items.map(({ applicationId, company, role, status, ...row }): DocumentSummary => ({
			...row,
			application: applicationId
				? { id: applicationId, company: company ?? "", role: role ?? "", status: status ?? "saved" }
				: null,
		})),
		total: totals?.[0]?.total ?? items.length,
	};
}

async function documentFacets(database: DbOrTx, input: ListInput) {
	const rows = library(database, input);
	const tagRows = database
		.select({ tag: sql<string>`unnest(${rows.tags})`.as("tag") })
		.from(rows)
		.as("document_tags");
	const tags = await database
		.selectDistinct({ tag: tagRows.tag })
		.from(tagRows)
		.where(
			and(
				sql`btrim(${tagRows.tag}) <> ''`,
				input.q.trim() ? sql`strpos(lower(${tagRows.tag}), lower(${input.q.trim()})) > 0` : undefined,
			),
		)
		.orderBy(sql`tag`)
		.limit(100);
	return { tags: [...new Set([...input.tags, ...tags.map((row) => row.tag)])] };
}

// Rows and filtered totals describe one database snapshot, including while another device edits the library.
export function listDocuments(input: ListInput) {
	return db.transaction((tx) => readDocuments(tx, input), {
		isolationLevel: "repeatable read",
		accessMode: "read only",
	});
}

export function listDocumentPage(input: ListInput) {
	return db.transaction(
		async (tx) => {
			const page = await readDocuments(tx, input);
			const facets = await documentFacets(tx, input);
			return { ...page, ...facets };
		},
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
}
