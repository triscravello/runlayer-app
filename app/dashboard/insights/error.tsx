"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";

export default function RecommendationInsightsError({
    error,
    unstable_retry,
}: {
    error: Error & { digest?: string };
    unstable_retry: () => void;
}) {
    useEffect(() => {
        console.error("Recommendation insights failed to render", error);
    }, [error]);

    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
            <Card className="max-w-lg border-red-100 bg-white shadow-sm">
                <CardHeader>
                    <CardTitle className="text-2xl text-slate-950">Unable to load insights</CardTitle>
                    <CardDescription>
                        RunLayer could not load your recommendation insights. Try again, or return to the dashboard while we recover.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                    <Button type="button" onClick={() => unstable_retry()}>
                        Try again
                    </Button>
                    <Button asChild variant="outline">
                        <Link href="/dashboard">Go to dashboard</Link>
                    </Button>
                </CardContent>
            </Card>
        </main>
    );
}