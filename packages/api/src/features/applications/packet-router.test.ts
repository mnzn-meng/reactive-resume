import { expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
const packets = vi.hoisted(() => ({ review: vi.fn(), export: vi.fn() }));
vi.mock("./packet", () => ({ applicationPackets: packets }));
import { packetRouter } from "./packet-router";
const user = {
	id: "owner",
	name: "Maya",
	email: "maya@example.test",
	emailVerified: true,
	createdAt: new Date(0),
	updatedAt: new Date(0),
};
const client = () =>
	createRouterClient(packetRouter, {
		context: { locale: "en-US", reqHeaders: new Headers(), user: user },
	});
const selection = {
	applicationId: "app",
	targetUrl: "https://jobs.lever.co/fictional/job",
	includeContact: false,
	answerIds: [],
	letterWords: null,
};
it("rejects absent approval, caller ownership and URL credentials before reading sources", async () => {
	for (const input of [
		{ selection, fingerprint: "a".repeat(64), reviewed: false },
		{ selection, fingerprint: "a".repeat(64), reviewed: true, userId: "victim" },
		{
			selection: { ...selection, targetUrl: "https://private:secret@jobs.lever.co/x/y" },
			fingerprint: "a".repeat(64),
			reviewed: true,
		},
	])
		await expect(client().export(input as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(packets.export).not.toHaveBeenCalled();
});
