import { expect, it, vi } from "vite-plus/test";
import { createProcedureClient } from "@orpc/server";

const deleteAccount = vi.hoisted(() => vi.fn());
vi.mock("@zhiye/auth/config", () => ({
	auth: { api: { getSession: vi.fn(async () => ({ session: { createdAt: new Date() } })) } },
}));
vi.mock("./service", () => ({ authService: { deleteAccount } }));
const { authRouter } = await import("./router");

it("deletes the signed-in account", async () => {
	deleteAccount.mockReset().mockResolvedValue(undefined);
	const remove = createProcedureClient(authRouter.deleteAccount, {
		context: {
			locale: "en-US",
			reqHeaders: new Headers(),
			user: {
				id: "owner",
				name: "Owner",
				email: "owner@example.test",
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		},
	});

	await expect(remove({})).resolves.toBeUndefined();
	expect(deleteAccount).toHaveBeenCalledWith({ userId: "owner" });
});
