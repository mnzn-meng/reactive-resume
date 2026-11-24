import type * as React from "react";
import { inputBaseClassName } from "@zhiye/ui/components/input";
import { cn } from "@zhiye/utils/style";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				inputBaseClassName,
				"flex field-sizing-content min-h-24 px-[11px] py-[9px] leading-[22px]",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
