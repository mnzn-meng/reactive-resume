import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { truncateCascade } from "../../test-database";
import { runStorageCleanup } from "../storage/cleanup";

const fixture = vi.hoisted(() => ({
	db: undefined as ReturnType<typeof drizzle> | undefined,
	storageKeys: new Set<string>(),
	failPrefixes: new Set<string>(),
	partialPrefixes: new Set<string>(),
	uploadHold: null as { started: () => void; promise: Promise<void> } | null,
	holds: new Map<
		string,
		{ promise: Promise<void>; release: () => void; started: Promise<void>; resolveStarted: () => void }
	>(),
}));

vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
vi.mock("../storage/service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../storage/service")>();
	actual.configureStorageService({
		list: async (prefix: string) => {
			const root = prefix.replace(/\/$/, "");
			return [...fixture.storageKeys].filter((key) => key === root || key.startsWith(`${root}/`));
		},
		read: async (key: string) =>
			fixture.storageKeys.has(key) ? { data: new Uint8Array(), size: 0, lastModified: new Date() } : null,
		write: async ({ key }: { key: string }) => {
			const hold = fixture.uploadHold;
			fixture.uploadHold = null;
			if (hold) {
				hold.started();
				await hold.promise;
			}
			fixture.storageKeys.add(key);
		},
		delete: async (prefix: string) => {
			const hold = fixture.holds.get(prefix);
			if (hold) {
				fixture.holds.delete(prefix);
				hold.resolveStarted();
				await hold.promise;
			}
			if (fixture.failPrefixes.has(prefix)) throw new Error("storage unavailable");
			const keys = [...fixture.storageKeys].filter((key) => key === prefix || key.startsWith(`${prefix}/`));
			if (fixture.partialPrefixes.has(prefix) && keys.length > 1) {
				for (const key of keys.slice(1)) fixture.storageKeys.delete(key);
				return true;
			}
			for (const key of keys) fixture.storageKeys.delete(key);
			return keys.length > 0;
		},
		healthcheck: async () => ({ status: "healthy", type: "local", message: "Synthetic storage" }),
	});
	return actual;
});
vi.mock("../resume/events", () => ({ publishResumeUpdated: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@reactive-resume/auth/config", () => ({
	auth: { $context: Promise.resolve({ secretConfig: { key: "synthetic-test-key" } }) },
	isCustomOAuthProviderEnabled: () => false,
}));
const renderPdf = vi.hoisted(() => vi.fn());
vi.mock("@reactive-resume/pdf/server", () => ({ createResumePdfFile: renderPdf }));
vi.mock("../resume/public-render-rate-limit", () => ({ publicRenderRateLimiter: { consume: vi.fn() } }));

function getDb() {
	if (!fixture.db) throw new Error("Test database is not initialized.");
	return fixture.db;
}

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;

// Real PostgreSQL, opt-in only. Every table and FK comes from shipped migrations in a unique schema, so this can run
// beside the other database suites without seeing their rows.
describe.skipIf(!databaseUrl)("Trash batch operations", () => {
	let service: typeof import("./service").documentsService;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `documents_test_${randomUUID().replaceAll("-", "")}`;

	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		pool = new Pool({
			connectionString: databaseUrl,
			max: 4,
			application_name: schemaName,
			connectionTimeoutMillis: 2000,
			options: `-c search_path=${schemaName}`,
		});
		fixture.db = drizzle({ client: pool });
		const migrations = new URL("../../../../../migrations/", import.meta.url);
		const directories = (await readdir(migrations, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
			.map((entry) => entry.name)
			.sort();
		for (const directory of directories) {
			const file = new URL(`${directory}/migration.sql`, migrations);
			if (!existsSync(file)) continue;
			await pool.query((await readFile(file, "utf8")).replaceAll('"public".', ""));
		}
		service = (await import("./service")).documentsService;
	}, 30_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	const trashedAt = () => new Date(Date.now() - 60_000);
	const resumeFiles = (userId: string, resumeId: string) => [
		`uploads/${userId}/screenshots/${resumeId}/preview.png`,
		`uploads/${userId}/pdfs/${resumeId}/public-cache.pdf`,
	];
	const putResumeFiles = (userId: string, resumeId: string) => {
		for (const key of resumeFiles(userId, resumeId)) fixture.storageKeys.add(key);
	};

	async function seed() {
		await truncateCascade(pool, ["released_username", "storage_cleanup_job", "user"]);
		await getDb()
			.insert(tables.user)
			.values(
				["alice", "bob"].map((id) => ({
					id,
					name: id,
					email: `${id}@example.test`,
					username: `${schemaName}-${id}`,
					displayUsername: `${schemaName}-${id}`,
				})),
			);
		await getDb()
			.insert(tables.resume)
			.values([
				{
					id: "alice-active",
					userId: "alice",
					name: "Active",
					data: structuredClone(defaultResumeData),
				},
				{
					id: "alice-trashed-1",
					userId: "alice",
					name: "Trashed one",
					trashedAt: trashedAt(),
					data: structuredClone(defaultResumeData),
				},
				{
					id: "alice-trashed-2",
					userId: "alice",
					name: "Trashed two",
					trashedAt: trashedAt(),
					data: structuredClone(defaultResumeData),
				},
				{
					id: "bob-trashed",
					userId: "bob",
					name: "Bob trash",
					trashedAt: trashedAt(),
					data: structuredClone(defaultResumeData),
				},
			]);
	}

	beforeEach(async () => {
		fixture.storageKeys.clear();
		fixture.failPrefixes.clear();
		fixture.partialPrefixes.clear();
		fixture.holds.clear();
		fixture.uploadHold = null;
		await seed();
	});

	it("lists submission hints without private job notes and keeps prepared links reversible", async () => {
		const { applicationService } = await import("../applications/service");
		const { resumeService } = await import("../resume/service");
		const id = await applicationService.create({
			userId: "alice",
			role: "Engineer",
			company: "Fictional",
			notes: "private memo",
			jobDescription: "private posting",
		});
		await service.linkApplication({ userId: "alice", id: "alice-active", applicationId: id });
		expect(await applicationService.getById({ userId: "alice", id })).toMatchObject({
			resumeId: "alice-active",
			sentResumeVersionId: null,
		});
		expect(await resumeService.getById({ userId: "alice", id: "alice-active" })).toMatchObject({
			applicationId: id,
		});
		const summary = (await applicationService.listSummary({ userId: "alice" })).items.find((item) => item.id === id);
		expect(summary).toMatchObject({ resumeId: "alice-active", sentResumeVersionId: null });
		expect(summary).not.toHaveProperty("notes");
		expect(summary).not.toHaveProperty("jobDescription");
		await service.linkApplication({ userId: "alice", id: "alice-active", applicationId: null });
		expect(await applicationService.getById({ userId: "alice", id })).toMatchObject({ resumeId: null });
		await service.linkApplication({ userId: "alice", id: "alice-active", applicationId: id });
		await applicationService.update({ userId: "alice", id, status: "applied" });
		const sent = (await applicationService.listSummary({ userId: "alice" })).items.find((item) => item.id === id);
		expect(sent?.sentResumeVersionId).toEqual(expect.any(String));
		const rows = await pool.query("SELECT resume_id, sent_resume_version_id FROM application WHERE id=$1", [id]);
		expect(rows.rows[0]).toEqual({
			resume_id: "alice-active",
			sent_resume_version_id: sent?.sentResumeVersionId,
		});
		expect((await applicationService.listSummary({ userId: "bob" })).items).toEqual([]);
	});

	it("restores only the selected loaded documents that are still in this account's Trash", async () => {
		const result = await service.restoreMany({
			userId: "alice",
			documents: [{ id: "alice-trashed-1" }, { id: "alice-active" }, { id: "bob-trashed" }],
		});

		expect(result).toEqual({ restored: 1 });
		const rows = await getDb()
			.select({ id: tables.resume.id, trashedAt: tables.resume.trashedAt })
			.from(tables.resume)
			.where(eq(tables.resume.userId, "alice"));
		expect(rows.find((row) => row.id === "alice-trashed-1")?.trashedAt).toBeNull();
		expect(rows.find((row) => row.id === "alice-active")?.trashedAt).toBeNull();
		const [bob] = await getDb()
			.select({ trashedAt: tables.resume.trashedAt })
			.from(tables.resume)
			.where(eq(tables.resume.id, "bob-trashed"));
		expect(bob?.trashedAt).not.toBeNull();
	});

	it("permanently deletes selected Trash documents, preserves active ones, and keeps submitted history rows", async () => {
		await getDb()
			.insert(tables.resumeVersion)
			.values({
				id: "sent-version",
				resumeId: "alice-trashed-1",
				userId: "alice",
				kind: "sent",
				data: structuredClone(defaultResumeData),
			});
		await getDb().insert(tables.application).values({
			id: "submitted",
			userId: "alice",
			company: "Orbital",
			role: "Engineer",
			status: "applied",
			resumeId: "alice-trashed-1",
			sentResumeVersionId: "sent-version",
			sentCheckScore: 82,
		});
		await getDb().insert(tables.application).values({
			id: "active-job",
			userId: "alice",
			company: "Lumen",
			role: "Designer",
			resumeId: "alice-active",
		});
		putResumeFiles("alice", "alice-trashed-1");

		const result = await service.purgeMany({
			userId: "alice",
			documents: [{ id: "alice-trashed-1" }, { id: "alice-active" }, { id: "bob-trashed" }],
		});

		expect(result).toEqual({ deleted: 1, skipped: 2 });
		const [active] = await getDb().select().from(tables.resume).where(eq(tables.resume.id, "alice-active"));
		expect(active).toBeDefined();
		const [foreign] = await getDb().select().from(tables.resume).where(eq(tables.resume.id, "bob-trashed"));
		expect(foreign).toBeDefined();
		expect(await getDb().select().from(tables.resume).where(eq(tables.resume.id, "alice-trashed-1"))).toHaveLength(0);

		const [submitted] = await getDb().select().from(tables.application).where(eq(tables.application.id, "submitted"));
		expect(submitted).toMatchObject({ resumeId: null, sentResumeVersionId: null, sentCheckScore: 82 });
		const [activeJob] = await getDb().select().from(tables.application).where(eq(tables.application.id, "active-job"));
		expect(activeJob?.resumeId).toBe("alice-active");
		expect(
			await getDb().select().from(tables.resumeVersion).where(eq(tables.resumeVersion.id, "sent-version")),
		).toHaveLength(0);
		expect(fixture.storageKeys.size).toBe(0);
	});

	it("keeps durable cleanup work when storage fails, then removes the private cache on retry", async () => {
		putResumeFiles("alice", "alice-trashed-1");
		fixture.failPrefixes.add("uploads/alice/screenshots/alice-trashed-1");
		fixture.failPrefixes.add("uploads/alice/pdfs/alice-trashed-1");

		const result = await service.purgeMany({
			userId: "alice",
			documents: [{ id: "alice-trashed-1" }],
		});

		expect(result).toEqual({ deleted: 1, skipped: 0 });
		expect(await getDb().select().from(tables.resume).where(eq(tables.resume.id, "alice-trashed-1"))).toHaveLength(0);
		expect(fixture.storageKeys.size).toBe(2);
		const failedJobs = await getDb()
			.select()
			.from(tables.storageCleanupJob)
			.where(eq(tables.storageCleanupJob.ownerId, "alice"));
		expect(failedJobs).toHaveLength(2);
		expect(failedJobs.every((job) => job.status === "pending" && job.lastError)).toBe(true);

		await getDb()
			.update(tables.storageCleanupJob)
			.set({ nextAttemptAt: new Date(0) })
			.where(eq(tables.storageCleanupJob.ownerId, "alice"));
		fixture.failPrefixes.clear();
		const summary = await runStorageCleanup({ ownerId: "alice", limit: 10 });

		expect(summary).toMatchObject({ completed: 2, failed: 0, partial: 0 });
		expect(fixture.storageKeys.size).toBe(0);
		expect(
			await getDb().select().from(tables.storageCleanupJob).where(eq(tables.storageCleanupJob.ownerId, "alice")),
		).toHaveLength(0);
	});

	it("retries only the objects left by a partial storage delete", async () => {
		putResumeFiles("alice", "alice-trashed-1");
		fixture.storageKeys.add("uploads/alice/pdfs/alice-trashed-1/older.pdf");
		fixture.partialPrefixes.add("uploads/alice/pdfs/alice-trashed-1");

		await service.purgeMany({ userId: "alice", documents: [{ id: "alice-trashed-1" }] });

		const [job] = await getDb()
			.select()
			.from(tables.storageCleanupJob)
			.where(eq(tables.storageCleanupJob.ownerId, "alice"));
		expect(job).toMatchObject({ status: "pending" });
		expect(job?.lastError).toContain("Partial storage delete");
		expect(fixture.storageKeys).toEqual(new Set(["uploads/alice/pdfs/alice-trashed-1/public-cache.pdf"]));

		await getDb()
			.update(tables.storageCleanupJob)
			.set({ nextAttemptAt: new Date(0) });
		fixture.partialPrefixes.clear();
		await runStorageCleanup({ ownerId: "alice", limit: 10 });

		expect(fixture.storageKeys.size).toBe(0);
		expect(
			await getDb().select().from(tables.storageCleanupJob).where(eq(tables.storageCleanupJob.ownerId, "alice")),
		).toHaveLength(0);
	});

	it("lets two cleanup workers share the queue without deleting a prefix twice", async () => {
		putResumeFiles("alice", "alice-trashed-1");
		fixture.failPrefixes.add("uploads/alice/screenshots/alice-trashed-1");
		fixture.failPrefixes.add("uploads/alice/pdfs/alice-trashed-1");
		await service.purgeMany({ userId: "alice", documents: [{ id: "alice-trashed-1" }] });
		await getDb()
			.update(tables.storageCleanupJob)
			.set({ nextAttemptAt: new Date(0) })
			.where(eq(tables.storageCleanupJob.ownerId, "alice"));
		fixture.failPrefixes.clear();

		const [first, second] = await Promise.all([
			runStorageCleanup({ ownerId: "alice", limit: 10 }),
			runStorageCleanup({ ownerId: "alice", limit: 10 }),
		]);

		expect(first.completed + second.completed + first.missing + second.missing).toBe(2);
		expect(fixture.storageKeys.size).toBe(0);
	});

	it("fences a stale worker so it cannot revive the newer worker's abandoned decision", async () => {
		const storageKey = "uploads/alice/pdfs/stale-cache.pdf";
		fixture.storageKeys.add(storageKey);
		const release = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		fixture.holds.set(storageKey, {
			promise: release.promise,
			release: release.resolve,
			started: started.promise,
			resolveStarted: started.resolve,
		});
		await getDb()
			.insert(tables.storageCleanupJob)
			.values({
				id: "stale-job",
				ownerId: "alice",
				storageKey,
				attempts: 6,
				nextAttemptAt: new Date(0),
			});

		const workerA = runStorageCleanup({ ownerId: "alice", limit: 1 });
		await started.promise;
		const [claimedByA] = await getDb()
			.select()
			.from(tables.storageCleanupJob)
			.where(eq(tables.storageCleanupJob.id, "stale-job"));
		expect(claimedByA).toMatchObject({ attempts: 7, status: "pending" });
		expect(claimedByA?.claimToken).toBeTruthy();

		await getDb()
			.update(tables.storageCleanupJob)
			.set({ nextAttemptAt: new Date(0) })
			.where(eq(tables.storageCleanupJob.id, "stale-job"));
		fixture.failPrefixes.add(storageKey);
		const workerB = await runStorageCleanup({ ownerId: "alice", limit: 1 });
		expect(workerB.abandoned).toBe(1);

		release.resolve();
		await workerA;
		const [after] = await getDb()
			.select()
			.from(tables.storageCleanupJob)
			.where(eq(tables.storageCleanupJob.id, "stale-job"));
		expect(after).toMatchObject({ attempts: 8, status: "abandoned", claimToken: null });
		expect(after?.lastError).toContain("storage unavailable");
	});

	it("survives actual account deletion and removes the account prefix after storage recovers", async () => {
		putResumeFiles("alice", "alice-trashed-1");
		fixture.failPrefixes.add("uploads/alice/screenshots/alice-trashed-1");
		fixture.failPrefixes.add("uploads/alice/pdfs/alice-trashed-1");
		await service.purgeMany({ userId: "alice", documents: [{ id: "alice-trashed-1" }] });
		expect(
			await getDb().select().from(tables.storageCleanupJob).where(eq(tables.storageCleanupJob.ownerId, "alice")),
		).toHaveLength(2);

		fixture.failPrefixes.add("uploads/alice");
		const { authService } = await import("../auth/service");
		await authService.deleteAccount({ userId: "alice" });

		expect(await getDb().select().from(tables.user).where(eq(tables.user.id, "alice"))).toHaveLength(0);
		const jobs = await getDb()
			.select()
			.from(tables.storageCleanupJob)
			.where(eq(tables.storageCleanupJob.ownerId, "alice"));
		expect(jobs).toHaveLength(1);
		expect(jobs[0]).toMatchObject({ storageKey: "uploads/alice", status: "pending" });
		expect(fixture.storageKeys.size).toBe(2);

		fixture.failPrefixes.clear();
		await getDb()
			.update(tables.storageCleanupJob)
			.set({ nextAttemptAt: new Date(0) })
			.where(eq(tables.storageCleanupJob.ownerId, "alice"));
		const summary = await runStorageCleanup({ ownerId: "alice", limit: 10 });
		expect(summary.completed).toBe(1);
		expect(fixture.storageKeys.size).toBe(0);
		expect(
			await getDb().select().from(tables.storageCleanupJob).where(eq(tables.storageCleanupJob.ownerId, "alice")),
		).toHaveLength(0);
	});

	it("holds account deletion behind an authorized upload and refuses publication after the owner is gone", async () => {
		const { uploadFile } = await import("../storage/service");
		const { authService } = await import("../auth/service");
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		fixture.uploadHold = { started: started.resolve, promise: release.promise };
		const upload = uploadFile({ userId: "alice", data: new Uint8Array([1]), contentType: "application/pdf" });
		await started.promise;
		const deletion = authService.deleteAccount({ userId: "alice" });
		try {
			await vi.waitFor(
				async () => {
					const { rows } = await admin.query(
						"SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
						[schemaName],
					);
					expect(rows[0]?.count).toBeGreaterThan(0);
				},
				{ timeout: 2_000 },
			);
		} finally {
			release.resolve();
			await Promise.allSettled([upload, deletion]);
		}
		await Promise.all([upload, deletion]);
		expect(await getDb().select().from(tables.user).where(eq(tables.user.id, "alice"))).toHaveLength(0);
		expect(fixture.storageKeys.size).toBe(0);
		expect(await getDb().select().from(tables.storageCleanupJob)).toHaveLength(0);
		await expect(
			uploadFile({ userId: "alice", data: new Uint8Array([2]), contentType: "application/pdf" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(fixture.storageKeys.size).toBe(0);
	});

	it("does not copy pending or abandoned erasure prefixes when guest work changes owners", async () => {
		const { migrateUserStorage } = await import("../storage/service");
		const { linkAnonymousAccount, setAccountLinkHook } =
			await vi.importActual<typeof import("@reactive-resume/auth/config")>("@reactive-resume/auth/config");
		putResumeFiles("alice", "alice-trashed-1");
		const sibling = "uploads/alice/pdfs/alice-trashed-10/keep.pdf";
		const picture = "uploads/alice/pictures/profile.jpg";
		fixture.storageKeys.add(sibling);
		fixture.storageKeys.add(picture);
		for (const prefix of ["uploads/alice/screenshots/alice-trashed-1", "uploads/alice/pdfs/alice-trashed-1"])
			fixture.failPrefixes.add(prefix);
		await service.purgeMany({ userId: "alice", documents: [{ id: "alice-trashed-1" }] });
		await getDb()
			.update(tables.storageCleanupJob)
			.set({ status: "abandoned" })
			.where(eq(tables.storageCleanupJob.storageKey, "uploads/alice/pdfs/alice-trashed-1"));
		setAccountLinkHook(async ({ fromUserId, toUserId, excludedStoragePrefixes }) =>
			migrateUserStorage(fromUserId, toUserId, excludedStoragePrefixes),
		);
		try {
			await linkAnonymousAccount({ fromUserId: "alice", toUserId: "bob" });
		} finally {
			setAccountLinkHook();
		}
		await getDb().delete(tables.user).where(eq(tables.user.id, "alice"));
		fixture.failPrefixes.clear();
		await runStorageCleanup({ ownerId: "alice", limit: 10 });
		expect([...fixture.storageKeys]).toEqual(
			expect.arrayContaining([sibling.replace("/alice/", "/bob/"), picture.replace("/alice/", "/bob/")]),
		);
		expect([...fixture.storageKeys].some((key) => key.includes("/alice-trashed-1/"))).toBe(false);
		expect([...fixture.storageKeys].some((key) => key.startsWith("uploads/alice/"))).toBe(false);
		expect(await getDb().select().from(tables.storageCleanupJob)).toHaveLength(0);
	});

	it("stops automatic retries after the bounded attempt count and keeps the failure visible", async () => {
		putResumeFiles("alice", "alice-trashed-1");
		fixture.failPrefixes.add("uploads/alice/screenshots/alice-trashed-1");
		fixture.failPrefixes.add("uploads/alice/pdfs/alice-trashed-1");
		await service.purgeMany({ userId: "alice", documents: [{ id: "alice-trashed-1" }] });

		for (let attempt = 2; attempt <= 8; attempt += 1) {
			await getDb()
				.update(tables.storageCleanupJob)
				.set({ nextAttemptAt: new Date(0) });
			await runStorageCleanup({ ownerId: "alice", limit: 10 });
		}

		const abandoned = await getDb()
			.select()
			.from(tables.storageCleanupJob)
			.where(eq(tables.storageCleanupJob.ownerId, "alice"));
		expect(abandoned).toHaveLength(2);
		expect(abandoned.every((job) => job.status === "abandoned" && job.attempts === 8 && job.lastError)).toBe(true);

		fixture.failPrefixes.clear();
		await getDb()
			.update(tables.storageCleanupJob)
			.set({ nextAttemptAt: new Date(0) });
		await runStorageCleanup({ ownerId: "alice", limit: 10 });
		expect(fixture.storageKeys.size).toBe(2);
		expect(
			await getDb().select().from(tables.storageCleanupJob).where(eq(tables.storageCleanupJob.ownerId, "alice")),
		).toHaveLength(2);
	});

	it("treats a missing prefix as already cleaned, without leaving a retry job", async () => {
		await service.purgeMany({ userId: "alice", documents: [{ id: "alice-trashed-1" }] });

		expect(
			await getDb().select().from(tables.storageCleanupJob).where(eq(tables.storageCleanupJob.ownerId, "alice")),
		).toHaveLength(0);
	});

	it("empties every one of this account's trashed documents without loading their IDs on the client", async () => {
		await getDb()
			.insert(tables.resume)
			.values(
				Array.from({ length: 12 }, (_, index) => ({
					id: `alice-bulk-${index}`,
					userId: "alice",
					name: `Bulk ${index}`,
					trashedAt: trashedAt(),
					data: structuredClone(defaultResumeData),
				})),
			);

		const result = await service.emptyTrash({ userId: "alice" });

		expect(result.deleted).toBe(14);
		const aliceTrash = await getDb()
			.select({ id: tables.resume.id })
			.from(tables.resume)
			.where(eq(tables.resume.userId, "alice"));
		expect(aliceTrash.map((row) => row.id)).toEqual(["alice-active"]);
		const bobTrash = await getDb().select().from(tables.resume).where(eq(tables.resume.userId, "bob"));
		expect(bobTrash.map((row) => row.id)).toEqual(["bob-trashed"]);
	});

	it("keeps large Empty Trash work bounded after the immediate cleanup pass", async () => {
		await getDb()
			.insert(tables.resume)
			.values(
				Array.from({ length: 150 }, (_, index) => ({
					id: `alice-scale-${index}`,
					userId: "alice",
					name: `Scale ${index}`,
					trashedAt: trashedAt(),
					data: structuredClone(defaultResumeData),
				})),
			);

		const result = await service.emptyTrash({ userId: "alice" });
		expect(result.deleted).toBe(153);
		const remaining = await getDb()
			.select()
			.from(tables.storageCleanupJob)
			.where(eq(tables.storageCleanupJob.ownerId, "alice"));
		expect(remaining).toHaveLength(104);
		expect(remaining.every((job) => job.status === "pending")).toBe(true);

		const summary = await runStorageCleanup({ ownerId: "alice", limit: 200 });
		expect(summary.missing).toBe(104);
		expect(
			await getDb().select().from(tables.storageCleanupJob).where(eq(tables.storageCleanupJob.ownerId, "alice")),
		).toHaveLength(0);
	}, 30_000);

	it("skips a selected document restored or purged by another request instead of failing the batch", async () => {
		await service.restoreMany({ userId: "alice", documents: [{ id: "alice-trashed-2" }] });
		await service.purgeMany({ userId: "alice", documents: [{ id: "alice-trashed-1" }] });

		const result = await service.purgeMany({
			userId: "alice",
			documents: [{ id: "alice-trashed-1" }, { id: "alice-trashed-2" }],
		});

		expect(result).toEqual({ deleted: 0, skipped: 2 });
		const [restored] = await getDb().select().from(tables.resume).where(eq(tables.resume.id, "alice-trashed-2"));
		expect(restored).toBeDefined();
	});
	it("keeps Last edited on content edits while every change still moves updatedAt and the save fence", async () => {
		await seed();
		const db = getDb();
		const resumeRef = { userId: "alice", id: "alice-active" };
		const past = new Date("2026-01-01T00:00:00Z");
		await db.update(tables.resume).set({ editedAt: past, updatedAt: past }).where(eq(tables.resume.id, "alice-active"));
		const read = async () => {
			const [resume] = await db.select().from(tables.resume).where(eq(tables.resume.id, "alice-active"));
			if (!resume) throw new Error("Seeded resume is missing.");
			return resume;
		};

		// Details: tags, rename, lock and unlock, Trash and restore.
		await service.setTags({ ...resumeRef, tags: ["design"] });
		await service.rename({ ...resumeRef, name: "Renamed" });
		await service.setLocked({ ...resumeRef, isLocked: true });
		await service.setLocked({ ...resumeRef, isLocked: false });
		await service.trash(resumeRef);
		await service.restore(resumeRef);
		const details = await read();
		expect(details.editedAt).toEqual(past);
		// updatedAt still moves, so a save from before these changes is still refused.
		expect(details.updatedAt.getTime()).toBeGreaterThan(past.getTime());
		const { resumeService } = await import("../resume/service");
		await expect(
			resumeService.update({ id: "alice-active", userId: "alice", name: "Stale", expectedUpdatedAt: past }),
		).rejects.toMatchObject({ code: "RESUME_VERSION_CONFLICT" });

		const listed = await service.list({ userId: "alice", trashed: false, q: "", tags: [], sort: "edited" });
		expect(listed.items.find((row) => row.id === "alice-active")?.editedAt).toEqual(past);

		// Content: a change to the resume's data moves Last edited.
		const data = structuredClone(details.data);
		data.basics.headline = "Staff engineer";
		await db.update(tables.resume).set({ data }).where(eq(tables.resume.id, "alice-active"));
		const content = await read();
		expect(content.editedAt?.getTime()).toBeGreaterThan(past.getTime());
		const after = await service.list({ userId: "alice", trashed: false, q: "", tags: [], sort: "edited" });
		expect(after.items[0]?.id).toBe("alice-active");
		expect(after.items[0]?.editedAt).toEqual(content.editedAt);
	}, 30_000);
	it("tells an open editor when the library renames, tags, trashes or restores a resume", async () => {
		await seed();
		const { publishResumeUpdated } = await import("../resume/events");
		const published = vi.mocked(publishResumeUpdated);
		const resumeRef = { userId: "alice", id: "alice-active" };
		const revision = async () => {
			const [row] = await getDb()
				.select({ updatedAt: tables.resume.updatedAt })
				.from(tables.resume)
				.where(eq(tables.resume.id, "alice-active"));
			if (!row) throw new Error("Seeded resume is missing.");
			return row.updatedAt.toISOString();
		};
		const writes = [
			() => service.rename({ ...resumeRef, name: "Renamed" }),
			() => service.setTags({ ...resumeRef, tags: ["design"] }),
			() => service.trash(resumeRef),
			() => service.restore(resumeRef),
		];

		for (const write of writes) {
			published.mockClear();
			await write();
			// One event per write, carrying the revision the write left, as the editor's own saves publish.
			expect(published).toHaveBeenCalledTimes(1);
			expect(published).toHaveBeenCalledWith({
				type: "resume.updated",
				resumeId: "alice-active",
				userId: "alice",
				updatedAt: await revision(),
				mutation: "update",
			});
		}

		published.mockClear();
		await service.restoreMany({
			userId: "alice",
			documents: [{ id: "alice-trashed-1" }, { id: "alice-letter" }],
		});
		expect(published.mock.calls.map(([event]) => event.resumeId)).toEqual(["alice-trashed-1"]);
	});
	it("names a second import of the same person apart from the first, ignoring Trash and other accounts", async () => {
		await seed();
		const { findFreeResumeName } = await import("../resume/naming");
		const db = getDb();
		const add = (id: string, userId: string, name: string) =>
			db.insert(tables.resume).values({ id, userId, name, data: structuredClone(defaultResumeData) });

		await expect(findFreeResumeName("alice", "Morgan Chen", "Engineering lead")).resolves.toBe("Morgan Chen");
		await add("first", "alice", "Morgan Chen");
		await add("bobs", "bob", "Morgan Chen — Engineering lead");
		await expect(findFreeResumeName("alice", "morgan chen", "Engineering lead")).resolves.toBe(
			"morgan chen — Engineering lead",
		);
		await add("second", "alice", "Morgan Chen — Engineering lead");
		await expect(findFreeResumeName("alice", "Morgan Chen", "Engineering lead")).resolves.toBe(
			"Morgan Chen — Engineering lead (2)",
		);
		await expect(findFreeResumeName("alice", "Morgan Chen")).resolves.toBe("Morgan Chen (2)");
		// A resume in Trash doesn't hold its name.
		await expect(findFreeResumeName("alice", "Trashed one")).resolves.toBe("Trashed one");
	}, 30_000);
});
