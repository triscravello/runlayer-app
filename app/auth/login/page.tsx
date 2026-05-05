"use client"

import LoginForm from "@/components/auth/LoginForm";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export default function LogInPage() {
    const router = useRouter();

    return (
        <div className="min-h-screen bg-background">
            <nav className="border-b border-border bg-card">
                <div className="max-w-7xl mx-auto px-4 md:px-8">
                    <div className="flex items-center justify-between h-16">
                        <button onClick={() => router.back()} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                            <ArrowLeft className="w-4 h-4" />
                            Back
                        </button>
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-[#10B981] rounded-lg flex items-center justify-center">
                                <span className="text-white text-xl">⚡</span>
                            </div>
                            <span className="text-xl">RunLayer</span>
                        </div>
                        <div className="w-16" />
                    </div>
                </div>
            </nav>

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