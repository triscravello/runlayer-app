"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";

export default function AppError({
    error,
    unstable_retry,
} : {
    error: Error & { digest?: string };
    unstable_retry: () => void;
}) {
    useEffect(() => {
        console.error("Route rendering failed", error);
    }, [error]);

    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
            <Card className="max-w-lg border-slate-200 bg-white shadow-sm">
                <CardHeader>
                    <CardTitle className="text-2xl text-slate-950">Something went wrong</CardTitle>
                    <CardDescription>
                        RunLayer could not load this screen. Try again, or retry to the dashboard if the issue continues.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                    <Button type="button" onClick={() => unstable_retry()}>
                        Try again
                    </Button>
                    <Button asChild variant="outline">
                        <a href="/dashboard">Go to dashboard</a>
                    </Button>
                </CardContent>
            </Card>
        </main>
    );
}