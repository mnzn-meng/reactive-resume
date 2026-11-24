import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { ORPCError } from "@orpc/server";
import z from "zod";
import { env } from "@reactive-resume/env/server";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { writableResumeDataSchema } from "@reactive-resume/schema/resume/write";
import { getDefaultFileName } from "@reactive-resume/utils/file";
import { contentDisposition } from "@reactive-resume/utils/http";
import { protectedProcedure } from "../../context";
import { pdfExportRateLimit, pdfRenderRateLimit } from "../../middleware/rate-limit";
import { resumeService } from "../resume/service";

const exportInput = z.object({
	id: z.string().min(1),
	format: z.enum(["pdf", "docx", "odt", "md", "json"]),
});
const exportOutput = z.object({ headers: z.object({ "content-disposition": z.string() }), body: z.file() });
const pdfOutput = z.object({
	headers: z.object({ "content-disposition": z.string() }),
	body: z.file().mime("application/pdf"),
});

/** Builds the download response (headers + body) for a resume in the requested format. */
export async function fileResponse(
	data: ResumeData,
	name: string,
	format: z.infer<typeof exportInput>["format"],
	json: unknown,
) {
	const filename = `${getDefaultFileName({ name, data })}.${format}`;
	let body: File;
	try {
		if (format === "json") body = new File([JSON.stringify(json, null, 2)], filename, { type: "application/json" });
		else if (format === "pdf") {
			const { createResumePdfFile } = await import("@reactive-resume/pdf/server");
			body = await createResumePdfFile({ data, filename, uploadOrigin: env.APP_URL });
		} else {
			const { getResumeSectionTitle } = await import("@reactive-resume/pdf/section-title");
			const resolveTitle = (id: string) => getResumeSectionTitle(data, id);
			if (format === "md") body = new File([buildMarkdown(data, resolveTitle)], filename, { type: "text/markdown" });
			else {
				const blob =
					format === "odt"
						? await (await import("@reactive-resume/odt")).buildOdt(data, resolveTitle)
						: await (await import("@reactive-resume/docx")).buildDocx(data, resolveTitle);
				body = new File([blob], filename, { type: blob.type });
			}
		}
	} catch (error) {
		console.error("[document export] Rendering failed", error);
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Couldn't generate the document. Try again." });
	}
	return { headers: { "content-disposition": contentDisposition(filename) }, body };
}

export const documentExports = {
	resume: protectedProcedure
		.route({
			method: "GET",
			path: "/resumes/{id}/exports/{format}",
			tags: ["Resumes"],
			operationId: "exportResumeFile",
			summary: "Download a resume in PDF, DOCX, ODT, Markdown or JSON",
			description: "Renders the resume as a file in the chosen format.",
			outputStructure: "detailed",
		})
		.input(exportInput)
		.output(exportOutput)
		.use(pdfExportRateLimit)
		.handler(async ({ context, input }) => {
			const resume = await resumeService.getById({ id: input.id, userId: context.user.id });
			return fileResponse(resume.data, resume.name, input.format, resume.data);
		}),
};

/** Renders document data as sent (an unsaved draft included): nothing is read from or written to the account. */
export const documentRenders = {
	resume: protectedProcedure
		.route({
			method: "POST",
			path: "/resumes/pdf-renders",
			tags: ["Resumes"],
			operationId: "createResumePdfRender",
			summary: "Render resume data as a PDF",
			description:
				"Renders the resume data in the request body, saved or not, and returns the PDF. Nothing is stored. Pictures are read with the same rules as exports. Request bodies are limited to 4 MiB. Requires authentication.",
			successDescription: "The rendered resume PDF.",
			outputStructure: "detailed",
		})
		.input(z.object({ data: writableResumeDataSchema }))
		.output(pdfOutput)
		.use(pdfRenderRateLimit)
		.handler(({ input }) => fileResponse(input.data, "", "pdf", null)),
};
