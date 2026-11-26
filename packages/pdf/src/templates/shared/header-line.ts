import type { ResumeData } from "@zhiye/schema/resume/data";

/**
 * What prints under the name: the headline, then the job intent's city and start date when the document carries them.
 * A Chinese resume reads "后端工程师 · 杭州 · 一个月内到岗" there, and an empty intent leaves the line as it was.
 */
export const headerSubtitle = (basics: ResumeData["basics"]) =>
	[
		basics.headline.trim() || (basics.jobIntent?.position?.trim() ?? ""),
		basics.jobIntent?.city?.trim() ?? "",
		basics.jobIntent?.availability?.trim() ?? "",
	]
		.filter(Boolean)
		.join(" · ");
