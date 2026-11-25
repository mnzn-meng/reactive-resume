import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

const migrationsFolder = fileURLToPath(new URL("../../../migrations", import.meta.url));
const v6Migration = "20261001042749_v6_release";

// Needs CREATE DATABASE permission; owns and deletes two disposable databases, never the supplied database.
describe.skipIf(!process.env.INTEGRATIONS_TEST_DATABASE_URL)("database migrations", () => {
	it("freezes Last edited at updated_at for documents that existed before edited_at, and only content edits move it", async () => {
		const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL;
		if (!databaseUrl) throw new Error("INTEGRATIONS_TEST_DATABASE_URL is required");
		const admin = new Pool({ connectionString: databaseUrl });
		const baselineFolder = await mkdtemp(path.join(tmpdir(), "rr-edited-at-"));
		const databaseName = `edited_at_upgrade_${randomUUID().replaceAll("-", "")}`;
		await admin.query(`CREATE DATABASE "${databaseName}"`);
		const url = new URL(databaseUrl);
		url.pathname = `/${databaseName}`;
		const pool = new Pool({ connectionString: url.toString(), max: 2 });
		const db = drizzle({ client: pool });
		try {
			for (const name of await readdir(migrationsFolder)) {
				if (name < v6Migration) await symlink(path.join(migrationsFolder, name), path.join(baselineFolder, name));
			}
			// The real upgrade path: documents that already exist in two accounts, with the times the library showed.
			await migrate(db, { migrationsFolder: baselineFolder });
			await pool.query(
				`INSERT INTO "user" (id,name,email,username,display_username) VALUES ('up-a','Ana','ana@example.test','ana','ana'),('up-b','Ben','ben@example.test','ben','ben')`,
			);
			await pool.query(
				`INSERT INTO resume (id,user_id,name,data,slug) VALUES ('a-resume','up-a','A resume','{"basics":{}}','a-resume'),('b-resume','up-b','B resume','{"basics":{}}','b-resume')`,
			);
			await pool.query(`UPDATE resume SET updated_at='2025-01-02T00:00:00Z' WHERE id='a-resume'`);
			await pool.query(`UPDATE resume SET updated_at='2025-02-02T00:00:00Z' WHERE id='b-resume'`);

			await migrate(db, { migrationsFolder });

			const baseline = (await pool.query(`SELECT id,user_id,updated_at,edited_at FROM resume ORDER BY id`)).rows as {
				id: string;
				user_id: string;
				updated_at: Date;
				edited_at: Date | null;
			}[];
			// No preset edited_at anywhere: the migration itself must freeze the baseline the library already showed.
			expect(baseline.map((row) => [row.id, row.edited_at?.getTime()])).toEqual(
				baseline.map((row) => [row.id, row.updated_at.getTime()]),
			);
			expect(baseline.every((row) => row.edited_at !== null)).toBe(true);

			const order = async (userId: string) =>
				(
					await pool.query(
						`SELECT id FROM (
							SELECT id,coalesce(edited_at,updated_at) AS at,user_id FROM resume
						) d WHERE user_id=$1 ORDER BY at DESC, id`,
						[userId],
					)
				).rows.map((row) => row.id as string);
			expect(await order("up-a")).toEqual(["a-resume"]);
			expect(await order("up-b")).toEqual(["b-resume"]);

			// What the documents service does for tags, rename, lock and Trash: the detail changes and Drizzle's
			// $onUpdate moves updated_at, but none of it may move "Last edited" or the default order.
			await pool.query(`UPDATE resume SET tags='{remote}',is_locked=true,name='Renamed' WHERE id='a-resume'`);
			await pool.query(`UPDATE resume SET updated_at=now() WHERE id='a-resume'`);
			const afterMetadata = (await pool.query(`SELECT edited_at,updated_at FROM resume WHERE id='a-resume'`))
				.rows[0] as { edited_at: Date; updated_at: Date };
			expect(afterMetadata.edited_at).toEqual(new Date("2025-01-02T00:00:00.000Z"));
			// The concurrency check still follows every write.
			expect(afterMetadata.updated_at.getTime()).toBeGreaterThan(Date.parse("2025-01-02T00:00:00Z"));
			expect(await order("up-a")).toEqual(["a-resume"]);
			expect(await order("up-b")).toEqual(["b-resume"]);

			// A real content edit advances it: the resume's data, and each of a letter's text, recipient and design fields.
			await pool.query(`UPDATE resume SET data=jsonb_set(data,'{basics,name}','"Ana"') WHERE id='a-resume'`);
			const editedAt = async (table: "resume", id: string) =>
				(await pool.query(`SELECT edited_at,updated_at FROM ${table} WHERE id=$1`, [id])).rows[0] as {
					edited_at: Date;
					updated_at: Date;
				};
			const resumeEdit = await editedAt("resume", "a-resume");
			expect(resumeEdit.edited_at.getTime()).toBeGreaterThan(Date.parse("2025-01-02T00:00:00Z"));
			expect(await order("up-a")).toEqual(["a-resume"]);

			// A transaction opened first can write last after waiting for another writer's row lock.
			// Compare in PostgreSQL, retaining microseconds instead of depending on JS millisecond timing.
			const earlierWriter = await pool.connect();
			const delayedWriter = await pool.connect();
			try {
				await delayedWriter.query("BEGIN");
				await earlierWriter.query("BEGIN");
				const earlier = await earlierWriter.query(
					`UPDATE resume SET data=jsonb_set(data,'{basics,name}','"Earlier writer"') WHERE id='a-resume' RETURNING edited_at::text AS at`,
				);
				const delayed = delayedWriter.query(
					`UPDATE resume SET data=jsonb_set(data,'{basics,name}','"Later writer"') WHERE id='a-resume' RETURNING edited_at > $1::timestamptz AS newer`,
					[earlier.rows[0].at],
				);
				await earlierWriter.query("COMMIT");
				const result = await delayed;
				await delayedWriter.query("COMMIT");
				expect(result.rows[0].newer).toBe(true);
			} finally {
				earlierWriter.release();
				delayedWriter.release();
			}

			// A document created after the migration starts its own clock, and the other account was never touched.
			await pool.query(`INSERT INTO resume (id,user_id,name,data) VALUES ('a-new','up-a','New','{}')`);
			expect((await editedAt("resume", "a-new")).edited_at).toBeInstanceOf(Date);
			expect((await editedAt("resume", "b-resume")).edited_at).toEqual(new Date("2025-02-02T00:00:00.000Z"));
		} finally {
			await pool.end();
			await admin.query(`DROP DATABASE "${databaseName}"`);
			await admin.end();
			await rm(baselineFolder, { recursive: true, force: true });
		}
	}, 30_000);

	it("creates the current schema, preserves v5 documents on upgrade, and supports retries", async () => {
		const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL;
		if (!databaseUrl) throw new Error("INTEGRATIONS_TEST_DATABASE_URL is required");
		const admin = new Pool({ connectionString: databaseUrl });
		const baselineFolder = await mkdtemp(path.join(tmpdir(), "rr-v5-migrations-"));
		try {
			for (const name of await readdir(migrationsFolder)) {
				if (name < v6Migration) await symlink(path.join(migrationsFolder, name), path.join(baselineFolder, name));
			}
			for (const upgrade of [false, true]) {
				const databaseName = `migration_test_${randomUUID().replaceAll("-", "")}`;
				await admin.query(`CREATE DATABASE "${databaseName}"`);
				const url = new URL(databaseUrl);
				url.pathname = `/${databaseName}`;
				const pool = new Pool({ connectionString: url.toString(), max: 1 });
				const db = drizzle({ client: pool });
				const data = {
					basics: { name: "Migration fixture" },
					picture: {},
					metadata: { notes: "private", layout: { pages: [{ main: ["letter", "keep"], sidebar: ["letter"] }] } },
					customSections: [
						{ id: "keep", type: "custom", items: [] },
						{
							id: "letter",
							type: "cover-letter",
							hidden: true,
							items: [{ id: "item", recipient: "Acme", content: "<p>Keep this letter</p>" }],
						},
					],
				};
				try {
					if (upgrade) {
						await migrate(db, { migrationsFolder: baselineFolder });
						await pool.query(
							`INSERT INTO "user" (id,name,email,username,display_username) VALUES ('owner','Owner','owner@example.test','owner','owner')`,
						);
						await pool.query(
							`INSERT INTO resume (id,user_id,name,data,slug) VALUES ('resume','owner','Resume',$1,'resume')`,
							[data],
						);
						await pool.query(
							`INSERT INTO application (id,user_id,company,role,resume_id,status,activity) VALUES ('rejected','owner','Acme','Engineer','resume','rejected','[{"type":"stage","stage":"saved"},{"type":"stage","stage":"rejected"}]')`,
						);
						await pool.query(
							`INSERT INTO application (id,user_id,company,role,status,archived) VALUES ('archived','owner','Other','Engineer','interviewing',true),('active','owner','Other','Engineer','saved',false)`,
						);
						for (const label of ["Imported", "AI edit", "Before restore", "Restored version", "Manual save"]) {
							await pool.query(
								`INSERT INTO resume_version (id,resume_id,user_id,data,label) VALUES ($1,'resume','owner',$2,$1)`,
								[label, data],
							);
						}
					}
					await migrate(db, { migrationsFolder });
					const actual = await pool.query(
						`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name`,
					);
					const expected = Object.values(schema)
						.filter((value) => is(value, PgTable))
						.flatMap((table) => {
							const config = getTableConfig(table);
							return config.columns.map((column) => ({ table_name: config.name, column_name: column.name }));
						})
						.sort((a, b) => a.table_name.localeCompare(b.table_name) || a.column_name.localeCompare(b.column_name));
					expect(actual.rows).toEqual(expected);

					// Every foreign key has a valid index that starts with its column, apart from the listed exceptions
					// (packages/db/src/foreign-key-indexes.test.ts). This reads the database, so it covers the SQL.
					const unindexed = await pool.query(
						`SELECT rel.relname AS "table", a.attname AS "column"
							FROM pg_constraint c
							JOIN pg_class rel ON rel.oid = c.conrelid
							JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
							WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
								AND NOT EXISTS (
									SELECT 1 FROM pg_index i
									WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1] AND i.indpred IS NULL AND i.indisvalid
								)
							ORDER BY 1, 2`,
					);
					expect(unindexed.rows.map((row) => `${row.table}.${row.column}`)).toEqual([
						"ai_content_report.user_id",
						"career_schedule.ai_provider_id",
						"resume_writing_review.user_id",
					]);

					// A prebuilt index that is not valid stops the migration; a valid one makes it a no-op.
					const indexMigration = (
						await Promise.all(
							(await readdir(migrationsFolder))
								.filter((name) => /^\d+_/.test(name))
								.map((name) => readFile(path.join(migrationsFolder, name, "migration.sql"), "utf8")),
						)
					).find((sql) => sql.includes("application_resume_id_index"));
					if (!indexMigration) throw new Error("The foreign-key index migration is missing.");
					// That migration predates the cover-letter and OAuth-provider removals. Replaying it against the current
					// schema needs the columns and tables it indexed, so stand them up for the replay and take them down again.
					await pool.query(
						`CREATE TABLE cover_letter (id text PRIMARY KEY, source_resume_id text, source_application_id text);
						 CREATE TABLE cover_letter_version (id text PRIMARY KEY, user_id text);
						 CREATE TABLE oauth_access_token (id text PRIMARY KEY, session_id text, user_id text, refresh_id text, client_id text);
						 CREATE TABLE oauth_client (id text PRIMARY KEY, user_id text);
						 CREATE TABLE oauth_consent (id text PRIMARY KEY, client_id text);
						 CREATE TABLE oauth_refresh_token (id text PRIMARY KEY, session_id text, user_id text, client_id text);
						 ALTER TABLE application ADD COLUMN cover_letter_id text, ADD COLUMN sent_cover_letter_version_id text;`,
					);
					const validity = (valid: boolean) =>
						pool.query(
							`UPDATE pg_index SET indisvalid = $1 WHERE indexrelid = 'application_resume_id_index'::regclass`,
							[valid],
						);
					await validity(false);
					await expect(pool.query(indexMigration)).rejects.toThrow(
						/application_resume_id_index exists but is not valid/,
					);
					await validity(true);
					await expect(pool.query(indexMigration)).resolves.toBeDefined();
					await pool.query(
						`DROP TABLE cover_letter, cover_letter_version, oauth_access_token, oauth_client, oauth_consent, oauth_refresh_token;
						 ALTER TABLE application DROP COLUMN cover_letter_id, DROP COLUMN sent_cover_letter_version_id;`,
					);
					if (upgrade) {
						expect((await pool.query("SELECT id,status,closed_reason FROM application ORDER BY id")).rows).toEqual([
							{ id: "active", status: "saved", closed_reason: null },
							{ id: "archived", status: "closed", closed_reason: null },
							{ id: "rejected", status: "closed", closed_reason: "not-selected" },
						]);
						expect((await pool.query("SELECT activity FROM application WHERE id='rejected'")).rows[0].activity).toEqual(
							[
								{ type: "stage", stage: "saved" },
								{ type: "stage", stage: "closed" },
							],
						);
						expect((await pool.query("SELECT id,kind,data FROM resume_version ORDER BY id")).rows).toEqual([
							{ id: "AI edit", kind: "ai", data },
							{ id: "Before restore", kind: "before-restore", data },
							{ id: "Imported", kind: "import", data },
							{ id: "Manual save", kind: "auto", data },
							{ id: "Restored version", kind: "restored", data },
						]);
						expect((await pool.query("SELECT data FROM resume")).rows[0].data).toEqual({
							...data,
							customSections: [data.customSections[0]],
							metadata: { notes: "private", layout: { pages: [{ main: ["keep"], sidebar: [] }] } },
						});
					}
					const before = (await pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
					await migrate(db, { migrationsFolder });
					expect((await pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows).toEqual(before);
				} finally {
					await pool.end();
					await admin.query(`DROP DATABASE "${databaseName}"`);
				}
			}
		} finally {
			await rm(baselineFolder, { recursive: true, force: true });
			await admin.end();
		}
	}, 30_000);
});
