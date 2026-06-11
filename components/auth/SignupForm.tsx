"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";
import { authService } from "@/services/authService";
import { useAuth } from "@/context/authContext";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupForm() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [location, setLocation] = useState("");
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

        if (!name.trim()) return "Full name is required";
        if (!normalizedEmail || !password) return "Email and password are required";
        if (!emailPattern.test(normalizedEmail)) return "Enter a valid email address";
        if (password.length < 8) return "Password must be at least 8 characters";
        if (!location.trim()) return "Location is required for weather-aware recommendations";
        return "";
    };

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
            const result = await authService.signup({ email: email.trim(), password, location: location.trim() });
            setUser(result.data.user);
            setSuccessMessage("Account created successfully. Redirecting...");
            router.replace(redirectTo);
            router.refresh();
        } catch (err) {
            const message = err instanceof Error ? err.message : "Signup failed. Please try again.";
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex items-center justify-center px-4 py-12 md:py-20">
            <div className="w-full max-w-md space-y-8">
                <div className="text-center">
                    <h1 className="text-3xl md:text-4xl mb-3">Start Optimizing Your Runs</h1>
                    <p className="text-muted-foreground">
                        Create your account to get personalized gear recommendations
                    </p>
                </div>

                <Card className="p-8">
                    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
                        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">{error}</p>}
                        {successMessage && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">{successMessage}</p>}
                        <div className="space-y-2">
                            <Label htmlFor="name">Full Name</Label>
                            <Input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" autoComplete="name" disabled={isSubmitting} required className="bg-input-background" />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" disabled={isSubmitting} required className="bg-input-background" />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
                            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" disabled={isSubmitting} required className="bg-input-background" />
                            <p className="text-xs text-muted-foreground">Use at least 8 characters</p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="location">Location</Label>
                            <Input id="location" type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="St. Petersburg, FL" autoComplete="address-level2" disabled={isSubmitting} required className="bg-input-background" />
                            <p className="text-xs text-muted-foreground">We&apos;ll use this for real-time weather data.</p>
                        </div>

                        <Button type="submit" disabled={isSubmitting} className="w-full bg-[#10B981] hover:bg[#059669] text-white h-12">
                            {isSubmitting ? "Creating account..." : "Create Account"}
                        </Button>

                        <p className="text-xs text-center text-muted-foreground">
                            By creating an account, you agree to our Terms of Service and Privacy Policy.
                        </p>
                    </form>
                </Card>
            </div>
        </div>
    );
}