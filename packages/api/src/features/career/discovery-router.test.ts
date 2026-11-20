import { beforeEach, expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { careerRouter } from "./router";

const service = vi.hoisted(() => ({ suggest: vi.fn(), track: vi.fn(), dismiss: vi.fn() }));
vi.mock("./role-suggestions", () => ({ suggestTargetRoles: service.suggest }));
vi.mock("./jobs", () => ({ careerJobs: { dismissOpportunity: service.dismiss } }));
vi.mock("./service", () => ({ careerService: { trackOpportunity: service.track } }));
vi.mock("../../middleware/rate-limit", async () => {
	const { os } = await import("@orpc/server");
	return {
		aiRequestRateLimit: os.middleware(({ next }) => next()),
		aiVoiceRateLimit: os.middleware(({ next }) => next()),
	};
});
const user = {
	id: "owner",
	name: "Synthetic Owner",
	email: "owner@example.test",
	emailVerified: true,
	createdAt: new Date(),
	updatedAt: new Date(),
};
const client = () =>
	createRouterClient(careerRouter, {
		context: { locale: "en-US", reqHeaders: new Headers(), user: user },
	});
beforeEach(() => vi.clearAllMocks());
it("suggests target roles for the signed-in account", async () => {
	const input = { providerId: "connection", recipientVersion: "a".repeat(64), resumeId: null, includeKnowledge: true };
	service.suggest.mockResolvedValue({ suggestions: [] });
	await expect(client().suggestTargetRoles(input)).resolves.toEqual({ suggestions: [] });
	expect(service.suggest).toHaveBeenCalledWith("owner", { ...input, locale: "en-US" }, undefined);
});
