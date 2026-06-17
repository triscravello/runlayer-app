"use client"

import LoginForm from "@/components/auth/LoginForm";

export default function LogInPage() {
    return (
        <div className="min-h-screen bg-background">
            <LoginForm />

            <div className="grid grid-cols-3 gap-4 pt-4">
                <div className="text-center">
                    <div className="text-2xl mb-1">⚡</div>
                    <div className="text-xs text-muted-foreground">Instant recommendations</div>
                </div>
                <div className="text-center">
                    <div className="text-2xl mb-1">🎯</div>
                    <div className="text-xs text-muted-foreground">98% accuracy</div>
                </div>
                <div className="text-center">
                    <div className="text-2xl mb-1">🌤️</div>
                    <div className="text-xs text-muted-foreground">Live weather</div>
                </div>
            </div>
        </div>
    );
}