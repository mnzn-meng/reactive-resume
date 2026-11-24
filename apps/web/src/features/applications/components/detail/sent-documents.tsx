import type { Application } from "../../types";
import type { IconName } from "@zhiye/ui/components/icon";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { suggestApplicationDocuments } from "@zhiye/schema/applications/document-suggestions";
import { applicationSentAt } from "@zhiye/schema/applications/outcomes";
import { Button, buttonVariants } from "@zhiye/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@zhiye/ui/components/dropdown-menu";
import { Icon } from "@zhiye/ui/components/icon";
import { IconButton } from "@zhiye/ui/components/icon-button";
import { useInvalidateApplications } from "../../use-application-actions";
import { useDocumentDownload } from "../../use-document-download";
import { FileAttachmentField } from "../file-attachment-field";
import { useDialogStore } from "@/dialogs/store";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type SentDocumentRowProps = {
	icon: IconName;
	name: string;
	status: React.ReactNode;
	children: React.ReactNode;
};

function SentDocumentRow({ icon, name, status, children }: SentDocumentRowProps) {
	return (
		<div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-xl border border-line p-3">
			<Icon name={icon} className="shrink-0 text-ink-2" />
			<div className="grid min-w-44 flex-1">
				<span className="truncate text-sm font-medium">{name}</span>
				<span className="text-xs text-ink-3">{status}</span>
			</div>
			{/* Actions keep their size and drop to a second line, right-aligned, when the name needs the width. */}
			<div className="ms-auto flex items-center gap-1">{children}</div>
		</div>
	);
}

type SentDocumentsProps = {
	application: Application;
	disabled: boolean;
	/** `workspace` (Apply tab): a section heading, the recorded submission line, and each row's current-draft actions. */
	variant?: "detail" | "workspace";
};

/**
 * WHAT YOU SENT: the linked resume (opening the version that was sent, read-only, with a way back to the latest).
 * Without one: Prepare a resume. Uploaded PDFs stay under "Attach a file".
 */
export function SentDocuments({ application, disabled, variant = "detail" }: SentDocumentsProps) {
	const { i18n } = useLingui();
	const navigate = useNavigate();
	const { download, downloading } = useDocumentDownload();
	const workspace = variant === "workspace";
	const invalidate = useInvalidateApplications();
	const queryClient = useQueryClient();
	const openDialog = useDialogStore((state) => state.openDialog);
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const [attaching, setAttaching] = useState(Boolean(application.resumeFileUrl));

	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: (error) => toastError(error, t`Couldn't save the documents. Try again.`),
	});
	const link = useMutation({
		...orpc.documents.linkApplication.mutationOptions(),
		onSettled: () => {
			invalidate(application.id);
			void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
		},
		onError: (error) => toastError(error, t`Couldn't save the documents. Try again.`),
	});
	const busy = disabled || update.isPending || link.isPending;

	const resume = documents?.find((document) => document.id === application.resumeId);
	const sentAt = applicationSentAt(application);
	const date = sentAt?.toLocaleDateString(i18n.locale, { month: "short", day: "numeric" }) ?? "—";

	// Current drafts stay editable after submission; the sent version above never changes.
	const draftMenu = (documentId: string) => (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<IconButton icon="dots-three" label={t`Resume options`} size="icon-xs" className="text-ink-2" />}
			/>
			<DropdownMenuContent align="end">
				<DropdownMenuItem
					onClick={() =>
						void navigate({
							to: "/builder/$resumeId",
							params: { resumeId: documentId },
							search: { applicationId: application.id },
						})
					}
				>
					<Icon name="pencil-simple" size={18} />
					<Trans>Edit current draft</Trans>
				</DropdownMenuItem>
				<DropdownMenuItem disabled={downloading !== null} onClick={() => void download(documentId)}>
					<Icon name="download-simple" size={18} />
					{downloading === documentId ? <Trans>Generating PDF…</Trans> : <Trans>Download current PDF</Trans>}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);

	return (
		<section aria-labelledby="application-sent" className="grid gap-2">
			{workspace ? (
				<div className="grid gap-1 pb-1">
					<h2 id="application-sent" className="text-lg leading-6 font-semibold">
						<Trans>What you sent</Trans>
					</h2>
					{/* Only a recorded submission gets the line; without one it would claim a send that never happened. */}
					{sentAt && (
						<p className="flex items-start gap-1.5 text-[13px] leading-[18px] text-ink-2">
							<Icon name="check-circle" size={16} className="mt-px shrink-0 text-accent-text" />
							<span>
								<Trans>
									Submission recorded {date}. The sent versions never change; current drafts stay editable. This record
									does not confirm employer receipt.
								</Trans>
							</span>
						</p>
					)}
				</div>
			) : (
				<h3 id="application-sent" className="text-xs font-semibold text-ink-3">
					{application.status === "saved" ? <Trans>Documents for this job</Trans> : <Trans>What you sent</Trans>}
				</h3>
			)}

			{application.resumeId && (
				<SentDocumentRow
					icon="file-text"
					name={resume?.name ?? t`Linked resume`}
					status={
						application.sentResumeVersionId ? (
							application.sentCheckScore !== null ? (
								<Trans>
									Version sent {date} · Check {i18n.number(application.sentCheckScore)}
								</Trans>
							) : (
								<Trans>Version sent {date}</Trans>
							)
						) : (
							<Trans>Linked · not sent yet</Trans>
						)
					}
				>
					<Link
						to="/builder/$resumeId"
						params={{ resumeId: application.resumeId }}
						search={{
							applicationId: application.id,
							...(application.sentResumeVersionId ? { version: application.sentResumeVersionId } : {}),
						}}
						// The row's own "Open" names the document it opens.
						aria-label={workspace && application.sentResumeVersionId ? t`Open the resume version sent` : t`Open resume`}
						className={buttonVariants({ size: "sm", variant: "secondary" })}
					>
						{workspace && application.sentResumeVersionId ? <Trans>Open sent version</Trans> : <Trans>Open</Trans>}
					</Link>
					{workspace && draftMenu(application.resumeId)}
				</SentDocumentRow>
			)}

			{suggestApplicationDocuments(application, documents ?? []).map((document) => (
				<Button
					key={document.id}
					size="sm"
					variant="secondary"
					className="h-auto min-h-9 justify-start text-start wrap-anywhere whitespace-normal"
					disabled={busy}
					onClick={() =>
						link.mutate({
							id: document.id,
							applicationId: application.id,
							expectedUpdatedAt: document.updatedAt,
						})
					}
				>
					<Icon name="file-text" size={16} />
					{t`Use ${document.name}`}
				</Button>
			))}

			{/* A closed or offer-stage application has an outcome, not a preparation task: nothing more will be sent. */}
			{(application.status === "closed" || application.status === "offer") &&
				!application.resumeId &&
				!application.resumeFileUrl && (
					<p className="text-[13px] text-ink-3">
						<Trans>Nothing recorded as sent.</Trans>
					</p>
				)}
			{application.status !== "closed" && application.status !== "offer" && !application.resumeId && (
				<Button
					size="sm"
					variant={application.resumeFileUrl ? "secondary" : "primary"}
					disabled={busy}
					onClick={() => openDialog("document.new", { step: "copy", applicationId: application.id })}
				>
					<Icon name="copy" size={16} />
					<Trans>Prepare a resume</Trans>
				</Button>
			)}

			{attaching ? (
				<FileAttachmentField
					value={
						application.resumeFileUrl
							? { url: application.resumeFileUrl, name: application.resumeFileName || t`Resume file` }
							: null
					}
					attachLabel={t`Attach a resume file (PDF, up to 10 MB)`}
					disabled={busy}
					onChange={(value) =>
						update.mutate({
							id: application.id,
							...(value ? { resumeFile: value } : { resumeFileUrl: null, resumeFileName: null }),
						})
					}
				/>
			) : (
				<button
					type="button"
					disabled={busy}
					onClick={() => setAttaching(true)}
					className="w-fit text-xs text-ink-3 underline underline-offset-2 hover:text-ink-2"
				>
					<Trans>Attach a file instead</Trans>
				</button>
			)}
		</section>
	);
}
