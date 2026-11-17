import { createRequire } from "node:module";
import { expect, it } from "vite-plus/test";

const ui = createRequire(new URL("../packages/ui/package.json", import.meta.url));
const shadcn = createRequire(ui.resolve("shadcn"));
const registry = createRequire(shadcn.resolve("@shadcn/registry"));
const sharedZod = createRequire(new URL("../packages/schema/package.json", import.meta.url));

it.each(["deepmerge", "deepmerge/dist/umd.js"])("%s cannot poison merged object prototypes", (entry) => {
	const merge = registry(entry);
	const payload = JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"isAdmin":true}}}');
	for (const target of [Object.create(null), payload]) {
		const merged = merge(target, payload);
		expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
		expect(merged.isAdmin).toBeUndefined();
		expect(Object.hasOwn(merged, "__proto__")).toBe(false);
		expect(Object.hasOwn(merged, "constructor")).toBe(false);
	}
	for (const placeholder of [null, undefined, 0, false, ""]) {
		const merged = merge({ session: placeholder }, { session: payload });
		expect(Object.getPrototypeOf(merged.session)).toBe(Object.prototype);
		expect(merged.session.isAdmin).toBeUndefined();
	}
	const symbol = Symbol("config");
	const merged = merge({ list: [1], nested: { left: true } }, { list: [2], nested: { right: true }, [symbol]: 3 });
	expect(merged).toEqual({ list: [1, 2], nested: { left: true, right: true }, [symbol]: 3 });
	expect(merge({}, { items: [payload] }).items[0].isAdmin).toBeUndefined();
});

it("rejects oversized collections before parsing elements in Zod 4", async () => {
	const { z } = sharedZod("zod");
	let parsed = 0;
	const schema = z.array(z.unknown().transform(() => ++parsed)).max(2);
	for (const result of [schema.safeParse(new Array(10_000)), await schema.safeParseAsync(new Array(10_000))]) {
		expect(result.success).toBe(false);
		expect(result.error.issues).toMatchObject([{ code: "too_big" }]);
		expect(result.error.issues).toHaveLength(1);
	}
	expect(parsed).toBe(0);
	expect(schema.parse(["one", "two"])).toEqual([1, 2]);
});
