import type { CSSProperties } from "react";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { SCENE } from "./scroll";
import { useTheme } from "@/features/theme/provider";

/**
 * 13 Footer: the desk the story was written at. Its objects lead back into the page (the resume to Write, the glasses
 * to Check, the letters to Share, the calendar to Prepare, the window to Remember), and its lamp switches the theme.
 */
export function LandingFooter() {
	return (
		<footer data-scene={SCENE.footer} className="relative overflow-hidden border-t border-line">
			<FooterDesk />
		</footer>
	);
}

type DeskSpot = {
	/** Its box over the drawing, in percent of the drawing's width and height: left, top, width, height. */
	box: [number, number, number, number];
	number: string;
	label: string;
	href: string;
};

const getDeskSpots = (): DeskSpot[] => [
	{ box: [38.2, 71, 18.8, 24], number: "01", label: t`Write`, href: "#write" },
	{ box: [77.6, 72, 10.2, 12], number: "03", label: t`Check`, href: "#check" },
	{ box: [1.2, 60, 18.4, 26], number: "05", label: t`Share`, href: "#share" },
	{ box: [19.8, 56, 9.4, 26], number: "06", label: t`Prepare`, href: "#prepare" },
	{ box: [30.3, 15, 36.9, 53], number: "07", label: t`Remember`, href: "#remember" },
];

const spotStyle = ([left, top, width, height]: DeskSpot["box"]): CSSProperties => ({
	left: `${left}%`,
	top: `${top}%`,
	width: `${width}%`,
	height: `${height}%`,
});

const spotClass = "group/spot absolute rounded-lg outline-none max-[700px]:hidden";
const spotWashClass =
	"absolute inset-0 rounded-lg outline-[1.5px] outline-transparent transition-[background-color,outline-color] duration-standard outline-solid group-hover/spot:bg-[oklch(0.5_0.1_150/0.08)] group-hover/spot:outline-accent group-focus-visible/spot:bg-[oklch(0.5_0.1_150/0.08)] group-focus-visible/spot:outline-accent";
const spotLabelClass =
	"pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 flex -translate-x-1/2 translate-y-1 items-center gap-1.5 rounded-sm bg-ink px-2 py-1 font-ui text-xs font-medium whitespace-nowrap text-bg opacity-0 shadow-e2 transition-[opacity,translate] duration-standard ease-enter group-hover/spot:translate-y-0 group-hover/spot:opacity-100 group-focus-visible/spot:translate-y-0 group-focus-visible/spot:opacity-100";

// Phones crop the 3:1 drawing to a 16:10 box (object-fit: cover), so it renders at 1.875× the viewport width there.
const deskSizes = "(max-width: 699px) 188vw, (min-width: 1800px) 1800px, 100vw";

/**
 * The desk at the end of the page: a resume, letters, a calendar, glasses and a lamp in front of an open window. Day
 * in the light theme, night in the dark one. Each drawing is blended into the page (white vanishes into the light
 * page, black into the dark one), so the desk seems to stand on the footer itself.
 */
function FooterDesk() {
	const { resolvedTheme, toggleTheme } = useTheme();
	const lampLabel = resolvedTheme === "dark" ? t`Switch to light mode` : t`Switch to dark mode`;

	return (
		<div className="footer-desk">
			<div aria-hidden="true" className="footer-dawn" />
			<img
				src="/illustrations/footer-desk-light.webp"
				srcSet="/illustrations/footer-desk-light-1600.webp 1600w, /illustrations/footer-desk-light-2400.webp 2400w, /illustrations/footer-desk-light.webp 3200w"
				sizes={deskSizes}
				alt=""
				width={2172}
				height={724}
				loading="lazy"
				decoding="async"
				draggable={false}
				className="footer-desk-art mix-blend-multiply dark:hidden"
			/>
			<img
				src="/illustrations/footer-desk-dark.webp"
				srcSet="/illustrations/footer-desk-dark-1600.webp 1600w, /illustrations/footer-desk-dark-2400.webp 2400w, /illustrations/footer-desk-dark.webp 3200w"
				sizes={deskSizes}
				alt=""
				width={2172}
				height={724}
				loading="lazy"
				decoding="async"
				draggable={false}
				className="footer-desk-art hidden mix-blend-lighten dark:block"
			/>

			{getDeskSpots().map((spot) => (
				<a key={spot.href} href={spot.href} className={spotClass} style={spotStyle(spot.box)}>
					<span aria-hidden="true" className={spotWashClass} />
					<span className={spotLabelClass}>
						<span aria-hidden="true" className="font-mono text-[10px] opacity-60">
							{i18n.number(Number(spot.number), { minimumIntegerDigits: 2 })}
						</span>
						{spot.label}
					</span>
				</a>
			))}

			<button
				type="button"
				onClick={() => toggleTheme()}
				aria-label={lampLabel}
				className={spotClass}
				style={spotStyle([88, 30, 10, 51])}
			>
				<span aria-hidden="true" className={spotWashClass} />
				<span aria-hidden="true" className={spotLabelClass}>
					{lampLabel}
				</span>
			</button>
		</div>
	);
}
