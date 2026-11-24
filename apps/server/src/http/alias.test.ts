import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@zhiye/env/server", () => ({
	env: { APP_URL: "https://zhiye.example", APP_ALIAS_URL: "https://zy.example" },
}));

const { handleAlias, onAppDomain } = await import("./alias");

const visit = (path: string) => handleAlias(new Request(`https://zy.example${path}`));

describe("the app's alias domain", () => {
	it.each(["/auth/login?redirect=%2Fdashboard", "/dashboard"])("moves %s to the app's own address for good", (path) => {
		const response = visit(path);
		expect(response?.status).toBe(301);
		expect(response?.headers.get("Location")).toBe(`https://zhiye.example${path}`);
	});

	it.each(["/", "/api/rpc/flags/get", "/authors"])("serves %s itself", (path) => {
		expect(visit(path)).toBeNull();
	});

	it("keeps a path that looks like another host on the app's own address", () => {
		expect(onAppDomain(new URL("https://zy.example//evil.example/login?next=1"))).toBe(
			"https://zhiye.example//evil.example/login?next=1",
		);
	});
});
