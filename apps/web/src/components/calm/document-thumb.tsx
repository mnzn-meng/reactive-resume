import type { ComponentProps } from "react";
import { cn } from "@reactive-resume/utils/style";

type DocumentThumbProps = Omit<ComponentProps<"span">, "children">;

/**
 * Calm document thumbnail, row size (`.dth`): a 32 by 44 sheet that stands for a resume at the start of a list row.
 * Paper is white in both themes and keeps square 2px corners, so its inks are fixed.
 */
export function DocumentThumb({ className, ...props }: DocumentThumbProps) {
	const line = "block h-0.5 rounded-[1px] bg-[#d3cfc7]";

	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex h-11 w-8 shrink-0 flex-col gap-[3px] rounded-paper bg-paper px-[5px] py-1.5 shadow-[0_0_0_1px_var(--line-2)]",
				className,
			)}
			{...props}
		>
			<span className="mb-0.5 block h-[3px] w-[55%] rounded-[1px] bg-[#2d3a4a]" />
			<span className={line} />
			<span className={cn(line, "w-4/5")} />
			<span className={line} />
			<span className={cn(line, "w-[65%]")} />
		</span>
	);
}
