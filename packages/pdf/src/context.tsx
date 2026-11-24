import type { ResumeData } from "@zhiye/schema/resume/data";
import type { Template } from "@zhiye/schema/templates";
import type { ReactNode } from "react";
import { createContext, use, useMemo } from "react";
import { templateLayouts } from "@zhiye/schema/templates";
import { isRTL } from "@zhiye/utils/locale";

type RenderContextValue = ResumeData & {
	rtl: boolean;
	/**
	 * Whether a two-column template lays its columns out from the right: its sidebar goes to the other side from
	 * where the template draws it. That's the side chosen in Design, or, without a choice, a right-to-left page.
	 */
	columnsReversed: boolean;
};

const RenderContext = createContext<RenderContextValue | null>(null);
type RenderProviderProps = {
	data: ResumeData;
	template?: Template | undefined;
	children: ReactNode;
};

export const RenderProvider = ({ data, template, children }: RenderProviderProps) => {
	const rtl = isRTL(data.metadata.page.locale);
	const chosenSide = data.metadata.layout.sidebarSide;
	const ownSide = template ? templateLayouts[template].sidebarSide : null;
	const columnsReversed = chosenSide && ownSide ? chosenSide !== ownSide : rtl;
	const contextValue = useMemo<RenderContextValue>(
		() => ({ ...data, rtl, columnsReversed }),
		[data, rtl, columnsReversed],
	);

	return <RenderContext.Provider value={contextValue}>{children}</RenderContext.Provider>;
};

export const useRender = (): RenderContextValue => {
	const context = use(RenderContext);

	if (!context) throw new Error("useRender must be called inside a <RenderProvider>.");

	return context;
};
