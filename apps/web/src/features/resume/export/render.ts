import type { PageMap } from "@zhiye/pdf/page-map";
import type { ResumeData } from "@zhiye/schema/resume/data";
import { createResumePdfBlob } from "@zhiye/pdf/browser";

export type RenderInput = {
	data: ResumeData;
	fontMirrorUrl?: string | undefined;
};
export type Rendered = { blob: Blob; pageMap: PageMap | undefined; lostCharacters: string[] | undefined };

/** One render with its page map and lost characters; runs in the PDF worker, or on the main thread without one. */
export async function renderResumePdf({ data, fontMirrorUrl }: RenderInput): Promise<Rendered> {
	let pageMap: PageMap | undefined;
	let lostCharacters: string[] | undefined;
	const blob = await createResumePdfBlob({
		data,
		fontMirrorUrl,
		onPageMap: (map) => {
			pageMap = map;
		},
		onLostCharacters: (characters) => {
			lostCharacters = characters;
		},
	});
	return { blob, pageMap, lostCharacters };
}
