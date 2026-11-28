import type { ApplicationStatus } from "./data";
import z from "zod";
import { APPLICATION_STATUSES, applicationClosedReasonSchema, applicationStatusSchema } from "./data";

export const MAX_APPLICATION_LANES = 40;
export const applicationLaneLabelSchema = z.string().trim().min(1).max(80);
export const applicationLaneColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a six-digit hex color.");

export const applicationLaneSchema = z.object({
	id: z.string().min(1),
	category: applicationStatusSchema,
	label: applicationLaneLabelSchema.nullable(),
	color: applicationLaneColorSchema,
	position: z.number().int().min(0),
	systemKey: applicationStatusSchema.nullable(),
	closedReason: applicationClosedReasonSchema.nullable(),
	retiredAt: z.coerce.date().nullable(),
});
export type ApplicationLane = z.infer<typeof applicationLaneSchema>;
export const applicationPipelineSchema = z.object({
	revision: z.number().int().min(0),
	lanes: z.array(applicationLaneSchema),
});
export type ApplicationPipeline = z.infer<typeof applicationPipelineSchema>;

const DEFAULT_COLORS: Record<ApplicationStatus, string> = {
	saved: "#8D8C80",
	applied: "#578BC7",
	screening: "#319FA8",
	interview: "#BB9135",
	offer: "#449D70",
	closed: "#C36B5C",
};

/**
 * A stage a domestic search expects but the canonical categories have no room for: 笔试 sits between sending the
 * application and the first interview, so it rides on `screening`. It is a user lane, so writers resolve it by id.
 */
const EXTRA_LANES: Record<
	string,
	{ id: string; category: ApplicationStatus; label: string; after: ApplicationStatus }[]
> = {
	zh: [
		{ id: "written-test", category: "screening", label: "笔试", after: "applied" },
		{ id: "group-interview", category: "interview", label: "群面", after: "screening" },
		{ id: "hr-interview", category: "interview", label: "HR 面", after: "interview" },
	],
};

/** Synthetic category IDs support clients connected to servers predating lane support. */
export function createDefaultApplicationLanes(locale = "en-US"): ApplicationLane[] {
	const language = locale.split("-")[0] ?? locale;
	const lanes: Omit<ApplicationLane, "position">[] = APPLICATION_STATUSES.map((category) => ({
		id: category,
		category,
		label: null,
		color: DEFAULT_COLORS[category],
		systemKey: category,
		closedReason: null,
		retiredAt: null,
	}));

	// Each extra lane follows the category it was slotted after, so the board reads in the order people work in.
	for (const extra of EXTRA_LANES[language] ?? []) {
		// Aim at the canonical lane: extras share a category with it, so matching on category would land after the wrong one.
		const at = lanes.findIndex((lane) => lane.systemKey === extra.after);
		lanes.splice(at + 1, 0, {
			id: extra.id,
			category: extra.category,
			label: extra.label,
			color: DEFAULT_COLORS[extra.category],
			systemKey: null,
			closedReason: null,
			retiredAt: null,
		});
	}

	return lanes.map((lane, position) => ({ ...lane, position }));
}

export function getActiveApplicationLanes(lanes: readonly ApplicationLane[]): ApplicationLane[] {
	return lanes
		.filter((lane) => !lane.retiredAt)
		.toSorted((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function getApplicationLane(
	lanes: readonly ApplicationLane[],
	application: { status: ApplicationStatus; laneId?: string | null | undefined },
): ApplicationLane {
	return (
		lanes.find((lane) => lane.id === application.laneId && lane.category === application.status) ??
		lanes.find((lane) => lane.systemKey === application.status && !lane.retiredAt) ?? {
			id: application.status,
			category: application.status,
			label: null,
			color: DEFAULT_COLORS[application.status],
			position: APPLICATION_STATUSES.indexOf(application.status),
			systemKey: application.status,
			closedReason: null,
			retiredAt: null,
		}
	);
}
