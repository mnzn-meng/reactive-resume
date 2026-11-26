import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Icon } from "@zhiye/ui/components/icon";
import { getLanguageName } from "@zhiye/utils/locale";
import { cn } from "@zhiye/utils/style";
import { CtaLink, SignInLink, labelClass } from "./ui";
import { LocaleCombobox } from "@/features/locale/combobox";

type LanguageDoorwayProps = { className?: string; nameClassName?: string };

/** The language switch in the header and footer; it opens the same list the account settings use. */
export function LanguageDoorway({ className, nameClassName }: LanguageDoorwayProps) {
	const { i18n } = useLingui();
	const name = getLanguageName(i18n.locale, i18n.locale, false);
	const content = (
		<>
			<Icon name="translate" size={16} />
			<span lang={i18n.locale} className={nameClassName}>
				{name}
			</span>
		</>
	);
	return (
		<LocaleCombobox
			render={(props) => (
				<button
					{...props}
					type="button"
					aria-label={t`Change language`}
					title={t`Change language`}
					className={cn("touch-target relative flex items-center", props.className, className)}
				>
					{content}
				</button>
			)}
		/>
	);
}

/**
 * 12 Closing call to action. The story hands over: Chen's Yunqi Cloud card rests at Interview on the board Tailor
 * started, and an empty card waits under Saved for the reader's own.
 */
export function Closing() {
	const stages = [
		{ label: t`Saved`, dot: "bg-stage-saved" },
		{ label: t`Applied`, dot: "bg-stage-applied" },
		{ label: t`Interview`, dot: "bg-stage-interview" },
		{ label: t`Offer`, dot: "bg-stage-offer" },
	];

	return (
		<section
			aria-labelledby="closing-title"
			className="relative mx-auto flex max-w-[1440px] flex-col items-center gap-7 border-t border-line px-(--gutter) pt-[16vh] pb-[18vh] text-center"
		>
			<div
				aria-hidden="true"
				className="mb-4 w-[min(100%,560px)] rounded-lg border border-dashed border-line-2 px-3.5 py-3"
			>
				<div className="font-martian grid grid-cols-4 gap-2 text-xs leading-none font-medium text-ink-3">
					{stages.map((stage) => (
						<span key={stage.label} className="flex min-w-0 items-center gap-[5px]">
							<span className={cn("size-[7px] shrink-0 rounded-full", stage.dot)} />
							{stage.label}
						</span>
					))}
				</div>
				<div className="mt-2.5 grid grid-cols-4 gap-2 text-start">
					<span className="flex h-11 items-center justify-center rounded-lg border-[1.5px] border-dashed border-accent font-display text-[15px] text-accent-text italic">
						{t`Yours`}
					</span>
					<span className="col-start-3 flex h-11 min-w-0 flex-col justify-center rounded-lg border border-line bg-raised px-2 font-ui text-[11.5px] leading-[1.2] font-semibold text-ink shadow-e2">
						{t`Yunqi Cloud`}
						<span className="truncate text-[10.5px] font-normal text-ink-3">{t`Interview done`}</span>
					</span>
				</div>
			</div>
			<span className={cn(labelClass, "text-ink-3")}>{t`Your turn`}</span>
			<h2
				id="closing-title"
				className="font-anybody text-[clamp(48px,6vw,108px)] leading-none font-light tracking-[-.03em] text-balance text-ink"
			>
				<Trans>
					Put it all on <em className="font-display font-normal text-accent-text italic">one page.</em>
				</Trans>
			</h2>
			<p className="max-w-[28em] font-display text-[clamp(17px,1.4vw,21px)] leading-normal text-pretty text-ink-2">
				{t`Start from scratch or import what you have. It takes a few minutes, and you can come back to it anytime.`}
			</p>
			<CtaLink size="closing" />
			<SignInLink />
		</section>
	);
}
