import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { defaultResumeData } from "@zhiye/schema/resume/default";

const mocks = vi.hoisted(() => ({
	select: vi.fn(),
	predicates: [] as unknown[],
	exportCareer: vi.fn(),
	getApplicationProfile: vi.fn(),
	getPipeline: vi.fn(),
}));
vi.mock("@zhiye/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@zhiye/db/schema", () => ({
	user: { id: "user.id" },
	resume: { userId: "resume.userId" },
	application: { userId: "application.userId" },
	aiContentReport: { userId: "aiContentReport.userId" },
	resumeVersion: { userId: "resumeVersion.userId" },
	aiRequest: { userId: "aiRequest.userId" },
	resumeWritingReview: { userId: "resumeWritingReview.userId" },
}));
vi.mock("drizzle-orm", () => ({ eq: (column: unknown, value: unknown) => ({ column, value }) }));
vi.mock("@zhiye/env/server", () => ({ env: {} }));
vi.mock("@zhiye/auth/config", () => ({ isCustomOAuthProviderEnabled: () => false }));
vi.mock("../storage/service", () => ({ getStorageService: vi.fn() }));
vi.mock("../applications/lanes", () => ({ applicationLaneService: { get: mocks.getPipeline } }));
vi.mock("../career/service", () => ({ careerService: { exportData: mocks.exportCareer } }));
vi.mock("../application-profile/service", () => ({ applicationProfileService: { get: mocks.getApplicationProfile } }));
vi.mock("../feedback/service", () => ({
	feedbackService: { exportData: vi.fn().mockResolvedValue({ links: [], comments: [], events: [] }) },
}));
const { authService } = await import("./service");

describe("account backup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.predicates.length = 0;
		mocks.getPipeline.mockResolvedValue({ revision: 0, lanes: [] });
		mocks.getApplicationProfile.mockResolvedValue({
			data: { email: "private@example.test" },
			reviewedAt: "2030-01-01T00:00:00.000Z",
			revision: "profile-revision",
		});
	});

	it("includes owned resumes, applications and career data", async () => {
		const career = {
			facts: [
				{
					id: "fact",
					text: "I led a warehouse migration.",
					source: { kind: "manual", id: "career-note", quote: "I led a warehouse migration." },
				},
			],
			artifacts: [
				{
					id: "brief",
					data: { kind: "brief", markdown: "Discuss the warehouse migration." },
					evidence: { factIds: ["fact"], sources: [] },
				},
			],
			transcripts: [{ id: "transcript", original: "I lead the migration.", edited: "I led the migration." }],
		};
		mocks.exportCareer.mockResolvedValue(career);
		const aiRequests = [{ id: "request", operationId: "operation", action: "writing-review", model: "model" }];
		const writingReviews = [{ resumeId: "resume", aiOperationId: "operation", inputText: "Owned wording" }];
		const application = { id: "application", userId: "owner", company: "Lumen", role: "Designer" };
		for (const rows of [
			[{ id: "owner", name: "Owner" }],
			[{ id: "resume", data: defaultResumeData }],
			[application],
			[
				{
					id: "approved-resume-version",
					userId: "owner",
					resumeId: "resume",
					kind: "named",
					data: defaultResumeData,
				},
			],
			[{ id: "report", userId: "owner", content: "Reported output" }],
			aiRequests,
			writingReviews,
		]) {
			mocks.select.mockReturnValueOnce({
				from: () => ({
					where: (predicate: unknown) => {
						mocks.predicates.push(predicate);
						return Promise.resolve(rows);
					},
				}),
			});
		}
		const exported = await authService.exportData({ userId: "owner" });
		expect(exported).toMatchObject({ resumes: [{ id: "resume" }] });
		// Applications come along, without the owner's id.
		expect(exported.applications).toEqual([{ id: "application", company: "Lumen", role: "Designer" }]);
		expect(mocks.exportCareer).toHaveBeenCalledExactlyOnceWith("owner");
		expect(exported.career).toEqual({ ...career, aiRequests, writingReviews });
		expect(mocks.predicates).toContainEqual({ column: "aiRequest.userId", value: "owner" });
		expect(mocks.predicates).toContainEqual({ column: "resumeWritingReview.userId", value: "owner" });
		expect(mocks.getApplicationProfile).toHaveBeenCalledExactlyOnceWith("owner");
		expect(exported.applicationProfile).toMatchObject({
			data: { email: "private@example.test" },
			revision: "profile-revision",
		});
		expect(exported.applicationPipeline).toEqual({ revision: 0, lanes: [] });
		expect(exported.documentVersions).toMatchObject({
			resumes: [{ id: "approved-resume-version", resumeId: "resume" }],
		});
		expect(exported.documentVersions.resumes[0]).not.toHaveProperty("userId");
		expect(mocks.predicates).toContainEqual({ column: "resumeVersion.userId", value: "owner" });
		expect(mocks.getPipeline).toHaveBeenCalledExactlyOnceWith("owner");
		expect(exported.aiContentReports).toEqual([{ id: "report", userId: "owner", content: "Reported output" }]);
		expect(mocks.predicates).toContainEqual({ column: "aiContentReport.userId", value: "owner" });
	});
});
