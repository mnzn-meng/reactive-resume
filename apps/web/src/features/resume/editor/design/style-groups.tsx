import type { ResumeData } from "@zhiye/schema/resume/data";
import type { WritableDraft } from "immer";
import type { CSSProperties } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { createContext, useContext, useId, useState } from "react";
import { Button } from "@zhiye/ui/components/button";
import { Icon } from "@zhiye/ui/components/icon";
import { Input } from "@zhiye/ui/components/input";
import { contrastOnWhite, parseColorString } from "@zhiye/utils/color";
import { cn } from "@zhiye/utils/style";
import { Field, Help, wellClassName } from "./fields";
import { ACCENTS, darkenForWhite, hexToRgba, normalizeHex, rgbaToHex } from "./presets";
import { ColorPicker } from "@/components/input/color-picker";
import { useResumeData, useUpdateResumeData } from "@/features/resume/builder/draft";

type Metadata = Pick<ResumeData["metadata"], "typography" | "design" | "page">;

/** Edits the design; `key` names the control, so dragging a slider is one undo step. */
type DesignWriter = (key: string, mutate: (metadata: WritableDraft<Metadata>) => void, discrete?: boolean) => void;

export type DesignSource = { metadata: Metadata | undefined; write: DesignWriter };

const DesignSourceContext = createContext<DesignSource | null>(null);

/** Points the Type, Color and Page groups at another design than the open resume's (a letter's own). */
export const DesignSourceProvider = DesignSourceContext.Provider;

export function useDesign(): DesignSource {
	const source = useContext(DesignSourceContext);
	const data = useResumeData();
	const updateResumeData = useUpdateResumeData();
	if (source) return source;
	return {
		metadata: data?.metadata,
		write: (key, mutate, discrete = false) =>
			updateResumeData(
				(draft) => mutate(draft.metadata),
				discrete ? { newStep: true } : { coalesceKey: `design.${key}` },
			),
	};
}

/** Color: eight accents or a custom hex, with its contrast on white and a darker shade when it's too light. */
export function ColorGroup() {
	const { i18n } = useLingui();
	const { metadata, write } = useDesign();
	const current = metadata ? (rgbaToHex(metadata.design.colors.primary) ?? "#000000") : "#000000";
	const [typed, setTyped] = useState<string | null>(null);
	const hexId = useId();
	if (!metadata) return null;

	const hex = typed ?? current;
	const typedHex = normalizeHex(hex);
	const valid = typedHex !== null;
	const normalized = typedHex ?? current;
	const opaque = parseColorString(metadata.design.colors.primary)?.a === 1;
	const selectedAccent = opaque ? ACCENTS.find((accent) => accent.hex === current) : undefined;
	const ratio = contrastOnWhite(typed === null ? metadata.design.colors.primary : normalized);
	const tooLight = valid && ratio < 4.5;

	const setAccent = (next: string, discrete = true) =>
		write(
			"accent",
			(draft) => {
				draft.design.colors.primary = hexToRgba(next);
			},
			discrete,
		);

	return (
		<div className="grid gap-3">
			<h3 className="-mb-3 flex items-baseline gap-3 pt-[18px] pb-2 t-section-title">
				<Trans>Accent</Trans>
				<span className="t-small text-ink-3">{selectedAccent ? i18n._(selectedAccent.label) : t`Custom`}</span>
			</h3>
			<RadioGroup
				aria-label={t`Accent color`}
				value={selectedAccent ? current : null}
				onValueChange={(value) => {
					setTyped(null);
					setAccent(value as string);
				}}
				// Touch: 48px swatches, four to a row.
				className="grid grid-cols-4 gap-x-2.5 gap-y-3.5"
			>
				{ACCENTS.map((accent) => (
					<Radio.Root
						key={accent.hex}
						value={accent.hex}
						aria-label={i18n._(accent.label)}
						title={i18n._(accent.label)}
						className="group/swatch grid cursor-pointer gap-1.5 text-start t-caption font-normal text-ink-2 data-checked:font-semibold data-checked:text-ink"
					>
						<span
							// The ring takes the swatch's own colour (ink-2 on dark, where a dark accent would vanish).
							className="grid h-10 place-items-center rounded-md shadow-[inset_0_0_0_1px_var(--line)] group-data-checked/swatch:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--c)] dark:shadow-[0_0_0_1px_var(--control-border)] dark:group-data-checked/swatch:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--ink-2)]"
							style={{ backgroundColor: accent.hex, "--c": accent.hex } as CSSProperties}
						>
							{selectedAccent?.hex === accent.hex && <Icon name="check" size={18} className="text-paper" />}
						</span>
						{i18n._(accent.label)}
					</Radio.Root>
				))}
			</RadioGroup>

			<Field label={<Trans>Custom</Trans>} help={<Trans>Contrast on white</Trans>} className="mt-1">
				<div className="flex items-center gap-2">
					<ColorPicker
						compact
						popupLabel={t`Custom accent color`}
						className={wellClassName}
						aria-label={t`Open the color picker`}
						value={metadata.design.colors.primary}
						onChange={(color) => {
							setTyped(null);
							write("accent", (draft) => {
								draft.design.colors.primary = color;
							});
						}}
					/>
					<Input
						aria-label={t`Custom color (hex)`}
						value={hex}
						spellCheck={false}
						className="font-mono text-[13px]/4 font-medium"
						aria-invalid={!valid}
						aria-describedby={valid ? undefined : `${hexId}-error`}
						onChange={(event) => {
							setTyped(event.target.value);
							const next = normalizeHex(event.target.value);
							if (next) setAccent(next, false);
						}}
						onBlur={() => setTyped(null)}
					/>
					{/* An unreadable value has no ratio: the one shown would be the old colour's. */}
					{valid && (
						<span
							className={cn(
								"w-[52px] shrink-0 text-end font-mono text-xs/4 font-medium",
								tooLight ? "text-warn-text" : "text-ink-2",
							)}
						>
							{i18n.number(ratio, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}:{i18n.number(1)}
						</span>
					)}
				</div>
			</Field>
			{!valid && (
				<p id={`${hexId}-error`} className="text-xs text-danger-text">
					<Trans>Use a hex color such as #2F5A8A.</Trans>
				</p>
			)}

			{tooLight && (
				<div className="grid gap-2 rounded-lg bg-warn-soft p-3 text-[13px] leading-[19px] text-warn-text" role="status">
					<span className="flex gap-2">
						<Icon name="circle-half" size={20} />
						<Trans>Too light for headings on white. It may be hard to read and print faintly.</Trans>
					</span>
					<Button
						size="sm"
						variant="secondary"
						className="w-fit"
						onClick={() => {
							setTyped(null);
							setAccent(darkenForWhite(normalized));
						}}
					>
						<Trans>Use a darker shade</Trans>
					</Button>
				</div>
			)}

			<Help className="-mt-1">
				<Trans>Used for headings, icons and the header band.</Trans>
			</Help>
		</div>
	);
}
