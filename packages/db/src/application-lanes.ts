import { createDefaultApplicationLanes } from "@zhiye/schema/applications/lanes";
export { MAX_APPLICATION_LANES } from "@zhiye/schema/applications/lanes";

/**
 * Shared by application writes and guest linking; matches the additive migration's deterministic IDs. System lanes key
 * on their category, extra lanes on their own id, so two lanes that share a category never collide.
 */
export function createDefaultOwnedApplicationLanes(userId: string, locale?: string) {
	return createDefaultApplicationLanes(locale).map((lane) => ({
		...lane,
		id: `application-lane:${userId}:${lane.systemKey ? lane.category : lane.id}`,
		userId,
	}));
}
