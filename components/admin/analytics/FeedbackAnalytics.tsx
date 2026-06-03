import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { PlatformAnalyticsData } from "@/lib/db/analyticsRepository";

function pct(value: number) {
    return `${Math.round(value * 100)}%`;
}

export function FeedbackAnalytics({ feedback }: { feedback: PlatformAnalyticsData["feedback"] }) {
    return (
        <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
                <CardTitle className="text-lg text-slate-950">Feedback Analytics</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-5">
                {[
                    ["Total Feedback", feedback.totalFeedback.toLocaleString()],
                    ["Helpful", feedback.helpfulFeedback.toLocaleString()],
                    ["Not Helpful", feedback.notHelpfulFeedback.toLocaleString()],
                    ["Submission Rate", feedback.submissionRate.toLocaleString()],
                    ["Helpful Feedback %", pct(feedback.helpfulPercent)],
                ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border bg-slate-50 p-4">
                        <div className="text-sm text-muted-foreground">{label}</div>
                        <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}