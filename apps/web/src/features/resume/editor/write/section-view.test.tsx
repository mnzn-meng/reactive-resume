// @vitest-environment happy-dom
import type { ResumeData } from "@zhiye/schema/resume/data";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { sampleResumeData } from "@zhiye/schema/resume/sample";
import { toast } from "@zhiye/ui/components/toast";
import { SectionView } from "./section-view";

const fixture = vi.hoisted(() => {
	const state = {
		data: null as ResumeData | null,
		update: vi.fn(),
		/**
		 * Zustand hands React the selector's result as a snapshot and compares it by reference. A selector that builds a
		 * new array or object therefore reads as "changed" on every render, which React turns into an endless render loop
		 * (the browser shows "This page couldn't load"). Mocking the store would hide exactly that, so keep the rule here.
		 */
		select: (selector: (resume: { data: ResumeData }) => unknown) => {
			const resume = { data: state.data as ResumeData };
			const first = selector(resume);
			if (!Object.is(first, selector(resume))) {
				throw new Error("A store selector must return the same reference for unchanged data, or React loops forever.");
			}
			return first;
		},
	};
	return state;
});

vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentBuilderResumeSelector: fixture.select,
	useUpdateResumeData: () => fixture.update,
}));
vi.mock("./actions", () => ({ addEntryTo: vi.fn() }));
vi.mock("./entry-row", () => ({ EntryRow: () => null, moveEntry: vi.fn() }));
vi.mock("./fields", () => ({ TextField: () => null }));
vi.mock("./outline", () => ({
	useProposedCount: () => 0,
	useSectionTitle: () => "",
	useSortSensors: () => [],
}));
vi.mock("./summary-editor", () => ({ SummaryEditor: () => null }));
vi.mock("./view", () => ({ openOutline: vi.fn() }));
vi.mock("@/components/input/icon-picker", () => ({ IconPicker: () => null }));
vi.mock("@/features/resume/editor/chrome/panel", () => ({
	PanelBody: ({ children }: { children?: unknown }) => children,
	PanelHeader: () => null,
}));
const ask = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => null as string | null));
vi.mock("@/hooks/use-confirm", () => ({ usePrompt: () => ask }));
vi.mock("@/libs/dnd", () => ({ dndContextProps: () => ({}) }));
vi.mock("@zhiye/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});

beforeEach(() => {
	fixture.data = structuredClone(sampleResumeData);
	vi.clearAllMocks();
	fixture.update.mockImplementation((recipe: (data: ResumeData) => void) => recipe(fixture.data as ResumeData));
});

it("sorts publications by date, newest first", () => {
	// A pair of entries with a clear order, so the assertion doesn't depend on the sample's own content.
	const [base] = fixture.data?.sections.publications.items ?? [];
	if (!base) throw new Error("The sample must include a publication to copy.");
	fixture.data = {
		...(fixture.data as ResumeData),
		sections: {
			...(fixture.data as ResumeData).sections,
			publications: {
				...(fixture.data as ResumeData).sections.publications,
				items: [
					{ ...base, id: "older", title: "Older paper", date: "2019" },
					{ ...base, id: "newer", title: "Newer paper", date: "2023" },
				],
			},
		},
	};

	render(
		<I18nProvider i18n={i18n}>
			<SectionView sectionId="publications" locked={false} />
		</I18nProvider>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Sort by date" }));

	expect(fixture.update).toHaveBeenCalledOnce();
	expect(fixture.update).toHaveBeenCalledWith(expect.any(Function), { newStep: true });
	expect(toast.add).not.toHaveBeenCalled();
	expect(fixture.data?.sections.publications.items.map((entry) => entry.title)).toEqual(["Newer paper", "Older paper"]);
});

const renderSection = (type: "publications" | "projects", locked: boolean, count: number) => {
	fixture.data = structuredClone(sampleResumeData);
	fixture.data.sections[type].items = fixture.data.sections[type].items.slice(0, count);
	return render(
		<I18nProvider i18n={i18n}>
			<SectionView sectionId={type} locked={locked} />
		</I18nProvider>,
	);
};

it("sorts custom publications and warns using titles, falling back to the entry id", () => {
	const data = fixture.data;
	if (!data) throw new Error("Missing resume fixture");
	const [first] = data.sections.publications.items;
	if (!first) throw new Error("Missing sample publication");
	const custom = {
		...data.sections.publications,
		id: "custom-publications",
		type: "publications" as const,
		items: [
			{ ...first, id: "forthcoming", title: " Forthcoming paper ", date: "Forthcoming", dates: undefined },
			{ ...first, id: "newest", date: "2025", dates: undefined },
			{ ...first, id: "untitled", title: "   ", date: "", dates: undefined },
		],
	};
	data.customSections.push(custom);
	const builtin = structuredClone(data.sections.publications.items);
	render(
		<I18nProvider i18n={i18n}>
			<SectionView sectionId={custom.id} locked={false} />
		</I18nProvider>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Sort by date" }));

	expect(custom.items.map((entry) => entry.id)).toEqual(["newest", "forthcoming", "untitled"]);
	expect(data.sections.publications.items).toEqual(builtin);
	expect(toast.add).toHaveBeenCalledWith({
		type: "warning",
		description:
			"Couldn't read the dates on Forthcoming paper and untitled, so they stay at the end. Fix their dates and sort again.",
	});
});

it.each([
	["a section without dated entries", "projects", false, 2],
	["a locked section", "publications", true, 2],
	["a section with one entry", "publications", false, 1],
	["an empty section", "publications", false, 0],
] as const)("does not offer date sorting for %s", (_label, type, locked, count) => {
	renderSection(type, locked, count);

	expect(screen.queryByRole("button", { name: "Sort by date" })).toBeNull();
});

it("refuses to rename a built-in section over a name another section shows", async () => {
	const data = fixture.data;
	if (!data) throw new Error("Missing resume fixture");
	// Experience takes a name of its own, so Education may no longer claim it.
	data.sections.experience.title = "Work history";

	render(
		<I18nProvider i18n={i18n}>
			<SectionView sectionId="education" locked={false} />
		</I18nProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Rename" }));

	await waitFor(() => expect(ask).toHaveBeenCalled());
	const options = ask.mock.calls[0]?.[1] as { validate?: (value: string) => string | undefined } | undefined;
	expect(options?.validate?.("Work history")).toBeTruthy();
	expect(options?.validate?.(" work HISTORY ")).toBeTruthy();
	expect(options?.validate?.("Learning")).toBeUndefined();
});
