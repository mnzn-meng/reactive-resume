import type { ReactNode } from "react";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { DialogDescription, DialogHeader, DialogTitle } from "@zhiye/ui/components/dialog";
import { templates } from "@/dialogs/resume/template/data";
import { useCurrentResume } from "@/features/resume/builder/draft";
import { useEditorStore } from "@/features/resume/editor/store";
import { formatRelativeTime, localeMap, resolveLocale } from "@/libs/locale";

/** The page language as Design › Page and the letter name it: "British English", not "English (United Kingdom)". */
function languageName(locale: string, displayLocale: string) {
	try {
		return new Intl.DisplayNames([displayLocale], { type: "language", languageDisplay: "dialect" }).of(locale);
	} catch {
		return undefined;
	}
}

type RowProps = { label: ReactNode; children: ReactNode };

function Row({ label, children }: RowProps) {
	return (
		<div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-4 border-t border-line py-2.5 first:border-t-0">
			<dt className="text-ink-3">{label}</dt>
			<dd className="min-w-0 break-words text-ink">{children}</dd>
		</div>
	);
}

/**
 * The document menu's Details: what this resume is, at a glance. When it was made and last edited, how it looks,
 * and how long it runs.
 */
export function DocumentDetails() {
	const { i18n } = useLingui();
	const resume = useCurrentResume();
	const pageCount = useEditorStore((state) => state.rendered.pageCount);
	const { template, page } = resume.data.metadata;

	return (
		<>
			<DialogHeader>
				<DialogTitle className="break-words">{resume.name}</DialogTitle>
				<DialogDescription>
					<Trans>Resume details</Trans>
				</DialogDescription>
			</DialogHeader>

			<dl className="text-sm leading-5">
				<Row label={<Trans>Created</Trans>}>
					<time dateTime={new Date(resume.createdAt).toISOString()}>
						{i18n.date(resume.createdAt, { dateStyle: "long" })}
					</time>
				</Row>
				<Row label={<Trans>Last edited</Trans>}>
					<time
						dateTime={new Date(resume.updatedAt).toISOString()}
						title={i18n.date(resume.updatedAt, { dateStyle: "long", timeStyle: "short" })}
					>
						{formatRelativeTime(resume.updatedAt, i18n.locale)}
					</time>
				</Row>
				<Row label={<Trans>Template</Trans>}>{i18n._(templates[template].name)}</Row>
				<Row label={<Trans>Language</Trans>}>
					{languageName(page.locale, i18n.locale) ?? i18n._(localeMap[resolveLocale(page.locale)])}
				</Row>
				<Row label={<Trans>Length</Trans>}>
					{pageCount > 0 ? <Plural value={pageCount} one="# page" other="# pages" /> : "—"}
				</Row>
			</dl>
		</>
	);
}
