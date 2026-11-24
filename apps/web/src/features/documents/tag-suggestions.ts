import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/libs/orpc/client";

/** Tags this account already uses, as the library's tag facets list them. */
export function useExistingTags(enabled = true): string[] {
	const { data } = useQuery({
		...orpc.documents.page.queryOptions({
			input: { q: "", tags: [], sort: "edited", trashed: false, limit: 1, offset: 0 },
		}),
		enabled,
		staleTime: 30_000,
	});

	return data?.tags ?? [];
}
