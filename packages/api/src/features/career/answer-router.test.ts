import { beforeEach, expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { answerRouter } from "./answer-router";

const service = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), reuse: vi.fn(), delete: vi.fn() }));
vi.mock("./answers", () => ({ reviewedAnswers: service }));
const user = {
	id: "owner",
	name: "Synthetic Owner",
	email: "owner@example.test",
	emailVerified: true,
	createdAt: new Date(),
	updatedAt: new Date(),
};
const client = () =>
	createRouterClient(answerRouter, {
		context: { locale: "en-US", reqHeaders: new Headers(), user: user },
	});
beforeEach(() => {
	vi.clearAllMocks();
	service.list.mockResolvedValue([]);
});
it("requires authentication and delegates reads with the credential owner", async () => {
	const anonymous = createRouterClient(answerRouter, {
		context: { locale: "en-US", reqHeaders: new Headers(), user: null },
	});
	await expect(anonymous.list({ applicationId: "app" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	await expect(client().list({ applicationId: "app" })).resolves.toEqual([]);
	expect(service.list).toHaveBeenCalledWith("owner", "app");
});
