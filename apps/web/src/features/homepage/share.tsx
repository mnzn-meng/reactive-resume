import type { IconName } from "@zhiye/ui/components/icon";
import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import { useState } from "react";
import { Icon } from "@zhiye/ui/components/icon";
import { SegmentedControl, SegmentedControlItem } from "@zhiye/ui/components/segmented-control";
import { cn } from "@zhiye/utils/style";
import { SCENE, useLanding } from "./scroll";
import { Sheet } from "./sheet";
import { Doodle, labelClass, TypedText } from "./ui";

/**
 * Colours that switch from the day palette to the night sky's once the sky is half dark (--nts), rather than passing
 * through greys that make the controls look disabled. Under reduced motion the scene rests at night.
 */
const byNight = (day: string, night: string) => `color-mix(in oklch, ${day}, ${night} calc(var(--nts) * 100%))`;
const nightPalette = {
	"--night-ink": byNight("var(--ink)", "oklch(0.95 0.01 95)"),
	"--night-ink-2": byNight("var(--ink-2)", "oklch(0.9 0.01 95)"),
	"--night-on-ink": byNight("var(--bg)", "oklch(0.18 0.02 265)"),
	"--night-accent": byNight("var(--accent-text)", "oklch(0.8 0.13 150)"),
	"--night-label": byNight("var(--accent-text)", "oklch(0.75 0.09 150)"),
	"--night-chip": byNight("var(--ink-2)", "oklch(0.9 0.05 150)"),
	"--night-chip-line": byNight("var(--line-2)", "oklch(0.8 0.12 150)"),
	"--night-line": byNight("var(--line)", "oklch(1 0 0 / .14)"),
	"--night-fill": byNight("var(--hover)", "oklch(1 0 0 / .08)"),
} as CSSProperties;

/** 46 stars, seeded so the server and the browser draw the same sky. */
const stars = (() => {
	let seed = 7;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	return Array.from({ length: 46 }, () => ({
		left: `${(random() * 100).toFixed(2)}%`,
		top: `${(random() * 100).toFixed(2)}%`,
		size: `${(1 + random() * 1.8).toFixed(1)}px`,
		opacity: Number((0.45 + random() * 0.55).toFixed(2)),
	}));
})();

const formats: { icon: IconName; label: string; extension: string }[] = [
	{ icon: "file-pdf", label: "PDF", extension: "pdf" },
	{ icon: "file-text", label: "Word", extension: "docx" },
	{ icon: "brackets-curly", label: "JSON", extension: "json" },
];

/**
 * 05 Export, the night scene. The page flies off to the top corner on a green trail, the file's name types out, and the
 * format controls and the formats it comes in appear.
 */
export function Share() {
	const active = useLanding((state) => state.activeScene === SCENE.share);
	const ready = useLanding((state) => state.shareReady);
	const [format, setFormat] = useState(0);
	const chosen = formats[format] ?? formats[0];
	const fileName = `alex-morgan-resume.${chosen?.extension ?? "pdf"}`;
	const label = t`Export`;

	return (
		<section
			id="share"
			data-scene={SCENE.share}
			data-pin
			aria-labelledby="share-title"
			className="relative h-[240vh] motion-reduce:[--nt:1] min-[900px]:h-[300vh]"
		>
			{/* --nt, the night, comes from the scroll engine (shareNight), which also hands it to the header. */}
			<div
				className="sticky top-0 h-svh overflow-clip [--f1:clamp(0,(var(--p)-.62)*14,1)] [--f2:clamp(0,(var(--p)-.68)*14,1)] [--f3:clamp(0,(var(--p)-.74)*14,1)] [--fl:clamp(0,(var(--p)-.1)/.34,1)] [--nts:clamp(0,(var(--nt)-.5)*1000,1)] [--pw:min(40vw,26vh)] [--tu:clamp(0,(var(--p)-.34)/.22,1)] [--ui:clamp(0,(var(--p)-.58)*8,1)] min-[900px]:[--pw:min(22vw,42vh)]"
				style={nightPalette}
			>
				{/* Twilight, strongest halfway through the night's fade: dusk as it falls, dawn as it lifts into Prepare. */}
				<div
					aria-hidden="true"
					className="absolute inset-0 bg-[linear-gradient(to_bottom,oklch(0.78_0.05_255),oklch(0.93_0.05_65))] opacity-[calc(var(--nt)*(1-var(--nt))*4)] dark:bg-[linear-gradient(to_bottom,oklch(0.28_0.04_260),oklch(0.36_0.05_45))]"
				/>
				<div
					aria-hidden="true"
					className="absolute inset-0 bg-[radial-gradient(120%_90%_at_70%_0%,oklch(0.21_0.05_266),oklch(0.1_0.035_268)_62%)] opacity-(--nt)"
				/>
				<div aria-hidden="true" className="absolute inset-0 [transform:translateY(calc(var(--p)*-8vh))] opacity-(--nt)">
					{stars.map((star) => (
						<span
							key={`${star.left}${star.top}`}
							className="absolute size-(--size) rounded-full bg-[oklch(0.95_0.02_95)]"
							style={{ left: star.left, top: star.top, opacity: star.opacity, "--size": star.size } as CSSProperties}
						/>
					))}
				</div>

				<Doodle
					name="plane"
					wipe="clamp(0, (var(--p) - .12) / .2, 1)"
					sizes="14vw"
					className="start-[7vw] top-[max(13vh,120px)] w-[14vw] translate-y-[calc(var(--p)*-30px)] rotate-[-8deg] opacity-[calc(var(--nt)*.85)]!"
				/>

				<svg
					aria-hidden="true"
					viewBox="0 0 100 100"
					preserveAspectRatio="none"
					className="absolute inset-0 size-full opacity-[calc(var(--nt)*.7*(1-clamp(0,(var(--p)-.36)*6,1)))] rtl:-scale-x-100"
				>
					<path
						d="M50 50 Q73 50 96 -20"
						pathLength={1}
						fill="none"
						stroke="oklch(0.8 0.12 150)"
						// Not non-scaling: that measures the dash in screen pixels, which breaks the pathLength-based draw.
						strokeWidth={0.1}
						strokeDasharray={1}
						className="[stroke-dashoffset:calc(1-var(--fl))]"
					/>
				</svg>

				<div className="absolute top-1/2 left-1/2 aspect-[612/792] w-(--pw) [transform:translate(-50%,-50%)_translate(calc(var(--dir)*var(--fl)*46vw),calc(var(--fl)*var(--fl)*-70vh))_rotate(calc(var(--dir)*var(--fl)*26deg))_scale(calc(1-var(--fl)*.78))] rounded-paper opacity-[calc(clamp(0,var(--p)*20,1)*(1-clamp(0,(var(--fl)-.6)*4,1)))] shadow-paper [transition:transform_.35s_var(--ease)]">
					<Sheet />
				</div>

				<div className="absolute inset-x-(--gutter) top-1/2 flex -translate-y-1/2 flex-col items-center gap-[26px] text-center">
					{/* This label is the visible first half of the heading. */}
					<span
						aria-hidden="true"
						className={cn(labelClass, "tracking-[.1em] text-(--night-label) opacity-[clamp(0,var(--tu)*20,1)]")}
					>
						{t`Every format, yours`}
					</span>
					<h2
						id="share-title"
						dir="ltr"
						className={cn(
							"font-anybody flex flex-wrap items-center justify-center text-[8vw] leading-[1.1] font-light tracking-[-.025em] text-(--night-ink) transition-opacity duration-300 min-[900px]:text-[clamp(34px,4.6vw,88px)]",
						)}
					>
						<span className="sr-only">{t`Every format, yours`} </span>
						<Icon
							name={chosen?.icon ?? "file-pdf"}
							className="me-[.2em] text-(--night-accent) opacity-[clamp(0,var(--tu)*20,1)]"
							style={{ fontSize: ".6em" }}
						/>
						{/* The caret rides on the last character typed. */}
						<TypedText
							text={fileName}
							progress="--tu"
							rate={60}
							className="[overflow-wrap:anywhere] [--caret:var(--night-accent)]"
							charClassName="typed-caret"
						/>
					</h2>

					<div
						inert={!ready}
						className={cn(
							"flex [transform:translateY(calc((1-var(--ui))*16px))] flex-wrap justify-center gap-3 opacity-(--ui)",
							!active && "pointer-events-none",
						)}
					>
						<SegmentedControl
							aria-label={t`Format`}
							value={format}
							onValueChange={(value) => setFormat(value as number)}
							className="h-auto rounded-lg border border-(--night-line) bg-(--night-fill) p-1"
						>
							{formats.map((item, index) => (
								<label key={item.label} className="contents">
									<SegmentedControlItem
										value={index}
										className="h-[34px] flex-none rounded-md px-3.5 font-ui text-(--night-ink-2) duration-300 not-data-checked:hover:text-(--night-ink) data-checked:bg-(--night-ink) data-checked:text-(--night-on-ink) data-checked:shadow-none"
									>
										<Icon name={item.icon} size={17} />
										{item.label}
									</SegmentedControlItem>
								</label>
							))}
						</SegmentedControl>
						<button
							type="button"
							className="flex h-11 items-center gap-1.5 rounded-lg bg-(--night-ink) px-[18px] font-ui text-sm font-semibold text-(--night-on-ink) transition-colors duration-standard"
						>
							<Icon name="download-simple" size={18} />
							{t`Download`}
						</button>
					</div>

					<ul className="flex flex-wrap justify-center gap-2.5">
						{formats.map((item, index) => (
							<li
								key={item.icon}
								className="font-martian flex h-9 [transform:translateY(calc((1-var(--f))*10px))] items-center gap-2 rounded-md border border-[color-mix(in_oklch,var(--night-chip-line)_calc(var(--f)*100%),transparent)] px-3.5 text-[11.5px] leading-none font-medium text-(--night-chip) opacity-(--f)"
								style={{ "--f": `var(--f${index + 1})` } as CSSProperties}
							>
								<Icon name={item.icon} size={18} />
								{item.label}
							</li>
						))}
					</ul>
				</div>

				<div className="absolute start-(--gutter) bottom-[clamp(20px,5vh,44px)] flex max-w-[90vw] flex-col gap-2.5 min-[900px]:max-w-[min(28em,34vw)]">
					<span className={cn(labelClass, "text-(--night-label)")}>05 / {label}</span>
					<p className="min-[900px]:short:hidden font-display text-base leading-[1.45] text-pretty text-(--night-ink) min-[900px]:text-[clamp(17px,1.35vw,20px)]">
						{t`Take it as PDF, Word, Markdown or JSON. Your resume is yours: no lock-in, and every format is free.`}
					</p>
				</div>
			</div>
		</section>
	);
}
