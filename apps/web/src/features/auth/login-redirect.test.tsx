// @vitest-environment happy-dom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

const mocks = vi.hoisted(() => ({
	callbackURL: "/builder/resume-123",
	navigate: vi.fn(),
	invalidate: vi.fn(),
	email: vi.fn(),
	username: vi.fn(),
	social: vi.fn(),
	passkey: vi.fn(),
	signup: vi.fn(),
	requestPasswordReset: vi.fn(),
	queryClient: { invalidateQueries: vi.fn(async () => {}) },
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({
		data: { google: "Google", github: "GitHub", linkedin: "LinkedIn", custom: "SSO", passkey: true },
	}),
	useQueryClient: () => mocks.queryClient,
	useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({
	useSearch: () => ({ callbackURL: mocks.callbackURL }),
	useRouter: () => ({ navigate: mocks.navigate, invalidate: mocks.invalidate }),
	useNavigate: () => mocks.navigate,
	useRouteContext: () => ({ flags: { smtpEnabled: true } }),
	Link: ({ to, search: _search, ...props }: ComponentProps<"a"> & { to: string; search?: unknown }) => (
		// oxlint-disable-next-line jsx-a11y/anchor-has-content -- The Link mock forwards children through props.
		<a href={to} {...props} />
	),
}));
vi.mock("@/libs/orpc/client", () => ({ orpc: { auth: { providers: { list: { queryOptions: () => ({}) } } } } }));
vi.mock("@/libs/auth/client", () => ({
	authClient: {
		requestPasswordReset: mocks.requestPasswordReset,
		signUp: { email: mocks.signup },
		signIn: { email: mocks.email, username: mocks.username, social: mocks.social, passkey: mocks.passkey },
	},
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn(), close: vi.fn() } }));

import { ForgotPasswordPage } from "./pages/forgot-password";
import { LoginPage } from "./pages/login";
import { RegisterPage } from "./pages/register";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.callbackURL = "/builder/resume-123";
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	mocks.invalidate.mockResolvedValue(undefined);
	for (const signIn of [
		mocks.email,
		mocks.username,
		mocks.social,
		mocks.passkey,
		mocks.signup,
		mocks.requestPasswordReset,
	])
		signIn.mockResolvedValue({ data: {}, error: null });
});
afterEach(cleanup);

function renderLogin() {
	return render(
		<I18nProvider i18n={i18n}>
			<LoginPage disableEmailAuth={false} disableSignups={false} allowGuestLogin={false} />
		</I18nProvider>,
	);
}

function submitLogin(container: HTMLElement, identifier: string, passwordValue = "password123") {
	const input = container.querySelector('input[name="identifier"]');
	const password = container.querySelector('input[name="password"]');
	const form = container.querySelector("form");
	if (!input || !password || !form) throw new Error("Login form is missing");
	fireEvent.change(input, { target: { value: identifier } });
	fireEvent.change(password, { target: { value: passwordValue } });
	fireEvent.submit(form);
}

describe("sign-in with a callback", () => {
	it("accepts a legacy password and prevents duplicate sign-in until a failed request finishes", async () => {
		let finish: (() => void) | undefined;
		mocks.email.mockReturnValue(
			new Promise((resolve) => {
				finish = () => resolve({ error: { message: "Invalid credentials" } });
			}),
		);
		const { container } = renderLogin();
		const submit = screen.getByRole<HTMLButtonElement>("button", { name: "Sign in" });
		submitLogin(container, "john@example.com", "old123");
		await waitFor(() => expect(mocks.email).toHaveBeenCalledOnce());
		expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ password: "old123" }));
		expect(submit.disabled).toBe(true);
		fireEvent.click(submit);
		expect(mocks.email).toHaveBeenCalledOnce();
		finish?.();
		await waitFor(() => expect(submit.disabled).toBe(false));
		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it("says a wrong password at the field, clears it, and drops the sentence on the next keystroke", async () => {
		mocks.email.mockResolvedValueOnce({ data: null, error: { code: "INVALID_EMAIL_OR_PASSWORD" } });
		const { container } = renderLogin();
		submitLogin(container, "john@example.com", "wrong-password");
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("That email, username or password doesn't match.");
		const password = container.querySelector<HTMLInputElement>('input[name="password"]');
		expect(password?.value).toBe("");
		expect(password?.getAttribute("aria-invalid")).toBe("true");
		if (password) fireEvent.change(password, { target: { value: "n" } });
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it.each(["john@example.com", "john"])(
		"resumes the signed server callback after email/username sign-in (%s)",
		async (identifier) => {
			const { container } = renderLogin();
			submitLogin(container, identifier);
			await waitFor(() =>
				expect(mocks.navigate).toHaveBeenCalledWith({ href: mocks.callbackURL, reloadDocument: false, replace: true }),
			);
		},
	);

	it("resumes the callback after passkey sign-in", async () => {
		renderLogin();
		fireEvent.click(screen.getByRole("button", { name: "Continue with a passkey" }));
		await waitFor(() =>
			expect(mocks.navigate).toHaveBeenCalledWith({ href: mocks.callbackURL, reloadDocument: false, replace: true }),
		);
	});
});

describe("account creation with a callback", () => {
	it("rejects a seven-character new password before contacting auth", async () => {
		const { container } = render(
			<I18nProvider i18n={i18n}>
				<RegisterPage disableEmailAuth={false} />
			</I18nProvider>,
		);
		for (const [name, value] of Object.entries({
			name: "New User",
			email: "new@example.com",
			password: "1234567",
		})) {
			const input = container.querySelector(`input[name="${name}"]`);
			if (!input) throw new Error(`Missing ${name} field`);
			fireEvent.change(input, { target: { value } });
		}
		const form = container.querySelector("form");
		if (!form) throw new Error("Missing registration form");
		fireEvent.submit(form);
		await waitFor(() => expect(screen.getByText("Use at least 8 characters.")).toBeDefined());
		expect(mocks.signup).not.toHaveBeenCalled();
	});
	it("signs up without a username and goes straight to the page that sent them", async () => {
		mocks.signup.mockResolvedValueOnce({ data: { token: "session" }, error: null });
		const { container } = render(
			<I18nProvider i18n={i18n}>
				<RegisterPage disableEmailAuth={false} />
			</I18nProvider>,
		);
		for (const [name, value] of Object.entries({
			name: "New User",
			email: "new@example.com",
			password: "password123",
		})) {
			const input = container.querySelector(`input[name="${name}"]`);
			if (!input) throw new Error(`Missing ${name} field`);
			fireEvent.change(input, { target: { value } });
		}
		const form = container.querySelector("form");
		if (!form) throw new Error("Missing registration form");
		fireEvent.submit(form);
		await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(expect.objectContaining({ replace: true })));
		// Empty asks the server to make the username from the email address.
		expect(mocks.signup).toHaveBeenCalledWith(expect.objectContaining({ username: "", email: "new@example.com" }));
		expect(screen.queryByText("Your account is ready")).toBeNull();
	});
});

it("focuses the replacement password-reset heading once and preserves subsequent action focus", async () => {
	render(
		<I18nProvider i18n={i18n}>
			<ForgotPasswordPage />
		</I18nProvider>,
	);
	fireEvent.change(screen.getByRole("textbox", { name: "Email address" }), { target: { value: "maya@example.com" } });
	fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
	const heading = await screen.findByRole("heading", { name: "Check your email" });
	expect(document.activeElement).toBe(heading);
	const resend = screen.getByRole("button", { name: "Send again" });
	resend.focus();
	fireEvent.click(resend);
	await waitFor(() => expect(mocks.requestPasswordReset).toHaveBeenCalledTimes(2));
	expect(document.activeElement).toBe(resend);
});
