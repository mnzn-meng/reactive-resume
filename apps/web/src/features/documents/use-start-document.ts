// Kept apart from ./new-document-dialog.tsx and ./import, so the library loads without the dialog or the importers.
import type { Template } from "@zhiye/schema/templates";
import type { Locale } from "@zhiye/utils/locale";
import { t } from "@lingui/core/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "@zhiye/ui/components/toast";
import { useNewDocumentsStore } from "./new-documents";
import { useDialogStore } from "@/dialogs/store";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

/** The files the importer reads: the Import page's picker and first run's "Choose a file". */
export const IMPORT_ACCEPT = ".pdf,.docx,.json,.zip,application/pdf,application/json,application/zip";

// One create at a time across every caller: a click repeated, or a dialog reopened, while one is in flight does nothing.
let starting = false;

/** `base`, or `base 2`, `base 3`… whichever no name in `taken` uses. */
function freeName(base: string, taken: readonly string[]) {
	const names = new Set(taken.map((name) => name.toLowerCase()));
	let name = base;
	for (let number = 2; names.has(name.toLowerCase()); number++) name = `${base} ${number}`;
	return name;
}

type BlankOptions = {
	/** A name the person typed. Without one the resume is "Untitled resume" and follows its headline. */
	name?: string | undefined;
	/** A page size other than the default A4. */
	pageSize?: "a4" | "letter" | undefined;
};

/** Start blank or try a sample: each creates the resume at once and opens it. */
export function useStartDocument(applicationId?: string, locale?: Locale) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const closeDialog = useDialogStore((state) => state.closeDialog);
	const markNew = useNewDocumentsStore((state) => state.markNew);
	const [creating, setCreating] = useState(false);
	const { mutateAsync: createResume } = useMutation(orpc.resume.create.mutationOptions());

	const created = async (id: string, forJob = applicationId) => {
		// A resume started for a job is linked once it exists; the editor already has no job to fill in.
		if (applicationId) await client.documents.linkApplication({ id, applicationId });
		markNew(id);
		void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
		if (forJob) void queryClient.invalidateQueries({ queryKey: orpc.applications.key() });
		closeDialog();
	};
	/** Whether the document was created; a click while another create is in flight creates nothing. */
	const start = async (task: () => Promise<void>) => {
		if (starting) return false;
		starting = true;
		setCreating(true);
		try {
			await task();
			return true;
		} catch (error) {
			toastError(error, t`Couldn't create the document. Try again.`);
			return false;
		} finally {
			starting = false;
			setCreating(false);
		}
	};

	return {
		creating,
		/** A blank resume; with `template`, in that template (chosen in the gallery before signing up). */
		startBlank: (template?: Template, { name, pageSize }: BlankOptions = {}) =>
			start(async () => {
				const resumeId = await createResume({
					name: name ?? t`Untitled resume`,
					tags: [],
					autoName: !name,
					withSampleData: false,
					...(locale ? { locale } : {}),
					...(template ? { template } : {}),
				});
				// `create` has no page size; the default is A4, so only another size needs this second call.
				if (pageSize && pageSize !== "a4")
					await client.resume.patch({
						id: resumeId,
						operations: [{ op: "replace", path: "/metadata/page/format", value: pageSize }],
					});
				await created(resumeId);
				void navigate({ to: "/builder/$resumeId", params: { resumeId } });
			}),
		trySample: () =>
			start(async () => {
				// Named as what it is, not a random slug, so it's never mistaken for the person's own resume.
				const resumes = await client.documents.list({ q: t`Sample resume` });
				const name = freeName(
					t`Sample resume`,
					resumes.map((resume) => resume.name),
				);
				const resumeId = await createResume({ name, tags: [], withSampleData: true, ...(locale ? { locale } : {}) });
				await created(resumeId);
				toast.add({ description: t`Sample resume added. Delete it anytime.` });
				void navigate({ to: "/builder/$resumeId", params: { resumeId } });
			}),
	};
}
