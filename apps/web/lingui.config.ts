import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
	sourceLocale: "en-US",
	// Accented, stretched English for checking layouts; not a shipped translation.
	pseudoLocale: "zu-ZA",
	// The interface ships in these two languages; `supportedLocales` in @zhiye/utils/locale mirrors the list.
	locales: ["en-US", "zh-CN", "zu-ZA"],
	fallbackLocales: {
		"zu-ZA": "en-US",
		default: "en-US",
	},
	format: formatter({
		lineNumbers: false,
	}),
	catalogs: [
		{
			path: "<rootDir>/locales/{locale}",
			include: ["src"],
		},
	],
});
