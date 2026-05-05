import { twMerge } from "tailwind-merge";
import { clsx, type ClassValue } from "clsx";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
};

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div 
            data-slot="skeleton"
            className={cn("bg-accent animate-pulse rounded-md", className)}
            {...props}
        />
    );
}

export { Skeleton };