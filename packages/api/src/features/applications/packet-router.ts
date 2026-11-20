import {
	applicationPacketSchema,
	approvePacketSchema,
	packetReviewSchema,
	packetSelectionSchema,
} from "@reactive-resume/schema/applications/autofill";
import { protectedProcedure } from "../../context";
import { applicationPackets } from "./packet";

export const packetRouter = {
	review: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/{applicationId}/packet-review",
			tags: ["Applications"],
			operationId: "reviewApplicationPacket",
			summary: "Review an owned application packet without AI or submission",
		})
		.input(packetSelectionSchema)
		.output(packetReviewSchema)
		.handler(({ context, input }) => {
			context.resHeaders?.set("Cache-Control", "private, no-store");
			return applicationPackets.review(context.user.id, input);
		}),
	export: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/packets",
			tags: ["Applications"],
			operationId: "exportApplicationPacket",
			summary: "Export explicitly reviewed PDF versions and scoped answers; never submit",
		})
		.input(approvePacketSchema)
		.output(applicationPacketSchema)
		.handler(({ context, input }) => {
			context.resHeaders?.set("Cache-Control", "private, no-store");
			return applicationPackets.export(context.user.id, input, context.resHeaders);
		}),
};
