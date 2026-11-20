import { beforeEach, expect, it, vi } from "vite-plus/test";
import { createProcedureClient } from "@orpc/server";
const service = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), delete: vi.fn() }));
vi.mock("./service", () => ({ applicationProfileService: service }));
import { applicationProfileRouter } from "./router";

const user = {
	id: "owner",
	name: "Owner",
	email: "owner@example.test",
	emailVerified: true,
	createdAt: new Date(0),
	updatedAt: new Date(0),
};
const context = () => ({ locale: "en-US" as const, reqHeaders: new Headers(), user: user });
beforeEach(() => {
	vi.clearAllMocks();
	service.get.mockResolvedValue(null);
	service.delete.mockResolvedValue(undefined);
});
it("reads the authenticated owner's profile", async () => {
	const get = createProcedureClient(applicationProfileRouter.get, { context: context() });
	expect(await get()).toBeNull();
	expect(service.get).toHaveBeenCalledExactlyOnceWith("owner");
});
it("rejects anonymous reads", async () => {
	await expect(
		createProcedureClient(applicationProfileRouter.get, {
			context: { locale: "en-US", reqHeaders: new Headers(), user: null },
		})(),
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	expect(service.get).not.toHaveBeenCalled();
});
it("rejects caller-supplied ownership and self-identification instead of silently stripping them", async () => {
	const save = createProcedureClient(applicationProfileRouter.save, { context: context() });
	for (const input of [
		{ data: {}, expectedRevision: null, userId: "victim" },
		{ data: { selfIdentification: { disability: "no" } }, expectedRevision: null },
	]) {
		await expect(save(input as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
	}
	expect(service.save).not.toHaveBeenCalled();
});
