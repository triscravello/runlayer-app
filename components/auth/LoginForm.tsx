"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { authService } from "@/services/authService";
import { useAuth } from "@/context/authContext";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginForm() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const router = useRouter();
    const { setUser } = useAuth();
    const redirectTo = useMemo(() => {
        if (typeof window === "undefined") return "/dashboard";
        return new URLSearchParams(window.location.search).get("redirect") || "/dashboard";
    }, []);

    const validate = () => {
        const normalizedEmail = email.trim();

        if (!normalizedEmail || !password) {
            return "Email and password are required";
        }

        if (!emailPattern.test(normalizedEmail)) {
            return "Enter a valid email address";
        }

        return "";
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSuccessMessage("");

        const validationError = validate();
        if (validationError) {
            setError(validationError);
            return;
        }

        setIsSubmitting(true);

        try {
            const result = await authService.login({ email: email.trim(), password });
            setUser(result.data.user);
            setSuccessMessage("Logged in successfully. Redirecting...");
            router.replace(redirectTo);
            router.refresh();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Invalid email or password.";
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex items-center justify-center px-4 py-12 md:py-20">
            <div className="w-full max-w-md space-y-8">
                <div className="text-center">
                    <h1 className="text-3xl md:text-4xl mb-3">Log In</h1>
                    <p className="text-muted-foreground">Access your saved kits and personalized recommendations.</p>
                </div>

                <Card className="p-8">
                    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
                        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">{error}</p>}
                        {successMessage && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">{successMessage}</p>}

                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                autoComplete="email"
                                disabled={isSubmitting}
                                required
                                className="bg-input-background"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="email">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                autoComplete="current-password"
                                disabled={isSubmitting}
                                required
                                className="bg-input-background"
                            />
                        </div>

                        <Button type="submit" disabled={isSubmitting} className="w-full bg-[#10B981] hover:bg-[#059669] text-white h-12">
                            {isSubmitting ? "Logging in..." : "Log In"}
                        </Button>
                    </form>
                </Card>
            </div>
        </div>
    );
}