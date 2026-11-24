import { t } from "@lingui/core/macro";
import { useState } from "react";
import { downloadWithAnchor, generateFilename } from "@zhiye/utils/file";
import { toastError } from "@/libs/error-message";
import { client } from "@/libs/orpc/client";

/** Downloads the current draft of a linked resume as a PDF; `downloading` is the busy document's id. */
export function useDocumentDownload() {
	const [downloading, setDownloading] = useState<string | null>(null);
	const download = async (documentId: string) => {
		setDownloading(documentId);
		try {
			const { createExportFile } = await import("@/features/resume/export/use-resume-export");
			const resume = await client.resume.getById({ id: documentId });
			downloadWithAnchor(await createExportFile(resume, "pdf"), generateFilename(resume.name, "pdf"));
		} catch (error) {
			toastError(error, t`Couldn't generate the PDF. Try again.`);
		} finally {
			setDownloading(null);
		}
	};
	return { download, downloading };
}
