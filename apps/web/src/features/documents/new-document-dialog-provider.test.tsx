// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dialog } from "@zhiye/ui/components/dialog";

const api = vi.hoisted(() => ({
	providers: vi.fn(),
	createResume: vi.fn(),
	listDocuments: vi.fn(),
	linkApplication: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/features/applications/queries", () => ({
	applicationsListQueryKey: () => ["applications"],
	applicationsListQueryOptions: () => ({ queryKey: ["applications"], queryFn: async () => [] }),
}));
vi.mock("@/libs/orpc/client", () => ({
	client: {
		documents: { list: api.listDocuments, linkApplication: api.linkApplication },
	},
	orpc: {
		aiProviders: {
			list: { queryOptions: () => ({ queryKey: ["providers"], queryFn: api.providers, retry: false }) },
		},
		documents: {
			key: () => ["documents"],
			copyForJob: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			list: {
				queryKey: () => ["documents", "list"],
				queryOptions: (options?: { input?: unknown }) => ({
					queryKey: ["documents", "list", options?.input],
					queryFn: () => api.listDocuments(options?.input),
				}),
			},
		},
		resume: {
			create: { mutationOptions: () => ({ mutationFn: api.createResume }) },
			patch: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
		},
	},
}));

import { peekImportFile } from "./import/pending-file";
import { NewDocumentDialog } from "./new-document-dialog";
import { setAccountScope } from "@/libs/auth/account-scope";

let queryClient: QueryClient;
beforeEach(() => {
	vi.clearAllMocks();
	setAccountScope("import-owner");
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	api.listDocuments.mockResolvedValue([]);
	api.providers.mockRejectedValue(new Error("Provider lookup offline"));
});
afterEach(() => {
	cleanup();
	queryClient.clear();
});

function mount(data?: { applicationId?: string; file?: File }) {
	return render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<Dialog open>
					<NewDocumentDialog data={data} />
				</Dialog>
			</QueryClientProvider>
		</I18nProvider>,
	);
}

it("creates one resume while a create is in flight, even across repeat clicks and a reopened dialog", async () => {
	let finish = (_resumeId: string) => {};
	api.createResume.mockReturnValue(new Promise((resolve) => (finish = resolve)));
	const first = mount();
	const button = screen.getByRole("button", { name: "Create resume" });
	fireEvent.click(button);
	fireEvent.click(button);
	first.unmount();

	mount();
	fireEvent.click(screen.getByRole("button", { name: "Create resume" }));
	await vi.waitFor(() => expect(api.createResume).toHaveBeenCalledTimes(1));

	await act(async () => finish("resume-1"));
	fireEvent.click(screen.getByRole("button", { name: "Create resume" }));
	await vi.waitFor(() => expect(api.createResume).toHaveBeenCalledTimes(2));
});

it("hands a dropped file to the Import page instead of reading it in the dialog", () => {
	const file = new File(["{}"], "resume.json", { type: "application/json" });
	mount({ file });
	expect(peekImportFile()).toBe(file);
	expect(navigate).toHaveBeenCalledWith({ to: "/dashboard/documents/import" });
	expect(screen.queryByRole("dialog")).toBeNull();
});
