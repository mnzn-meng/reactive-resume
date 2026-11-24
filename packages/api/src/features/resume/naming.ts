import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@zhiye/db/client";
import * as schema from "@zhiye/db/schema";

/**
 * A name none of the user's live resumes has, so two imports of one person stay apart in lists and pickers: `name`,
 * then "name — detail" (the headline), then a number.
 */
export async function findFreeResumeName(userId: string, name: string, detail?: string) {
	const rows = await db
		.select({ name: schema.resume.name })
		.from(schema.resume)
		.where(
			and(
				eq(schema.resume.userId, userId),
				isNull(schema.resume.trashedAt),
				sql`strpos(lower(${schema.resume.name}), lower(${name.slice(0, 94)})) = 1`,
			),
		);
	const taken = new Set(rows.map((row) => row.name.toLowerCase()));
	const free = (candidate: string) => !taken.has(candidate.toLowerCase());
	if (free(name)) return name;
	const described = detail?.trim() && detail.trim() !== name ? `${name} — ${detail.trim()}`.slice(0, 100) : null;
	if (described && free(described)) return described;
	const base = (described ?? name).slice(0, 94);
	for (let number = 2; ; number++) {
		if (free(`${base} (${number})`)) return `${base} (${number})`;
	}
}
