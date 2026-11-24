import { cn } from "@zhiye/utils/style";

type Props = React.ComponentProps<"img"> & {
	variant?: "logo" | "icon";
};

export function BrandIcon({ variant = "logo", className, ...props }: Props) {
	return (
		<>
			<img src={`/${variant}/dark.svg`} alt="职页" className={cn("hidden size-12 dark:block", className)} {...props} />
			<img src={`/${variant}/light.svg`} alt="职页" className={cn("block size-12 dark:hidden", className)} {...props} />
		</>
	);
}
