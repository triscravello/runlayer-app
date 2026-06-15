declare module "react-hook-form" {
    export type FieldError = { message?: string };
    export type FieldPath<T> = Extract<keyof T, string>;

    export function useForm<TFieldValues, TTransformedValues = TFieldValues>(options: {
        defaultValues: TFieldValues;
        mode?: string;
        resolver?: unknown;
    }): {
        formState: {
            errors: Partial<Record<FieldPath<TFieldValues>, FieldError>>;
            isDirty: boolean;
            isValid: boolean;
        };
        handleSubmit: (handler: (value: TTransformedValues) => void | Promise<void>) => (event?: unknown) => void;
        register: (name: FieldPath<TFieldValues>) => { name: string };
        reset: (values: TFieldValues) => void;
        control: unknown;
    };

    export function useWatch<TFieldValues>(options: { control: unknown; name: FieldPath<TFieldValues> }): string;
}

declare module "@hookform/resolvers/zod" {
    export function zodResolver(schema: unknown): unknown;
}