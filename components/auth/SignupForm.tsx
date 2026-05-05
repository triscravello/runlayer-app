"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";
import { authService } from "@/services/authService";

export default function SignupForm() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [location, setLocation] = useState("");
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSuccessMessage("");

        if (!email.trim() || !password.trim()) {
            setError("Email and password are required.");
            return;
        }
        setIsSubmitting(true);

        try {
            await authService.signup({ email, password });
            setSuccessMessage("Account created successfully. Redirecting...");
            router.push("/dashboard");
        } catch (err) {
            const message = err instanceof Error ? err.message: "Signup failed. Please try again.";
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    }

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
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && <p className="text-red-500 mb-4">{error}</p>}
                        {successMessage && <p className="text-emerald-600 mb-4">{successMessage}</p>}
                        <div className="space-y-2">
                            <Label htmlFor="name">Full Name</Label>
                            <Input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" required className="bg-input-background" />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="bg-input-background" />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
                            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="bg-input-background" />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="location">Location</Label>
                            <Input id="location" type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="St. Petersburg, FL" required className="bg-input-background" />
                            <p className="text-xs text-muted-foreground">We'll use this for real-time weather data.</p>
                        </div>

                        <Button type="submit" className="w-full bg-[#10B981] hover:bg[#059669] text-white h-12">{isSubmitting ? "Creating account..." : "Create Account"}</Button>

                        <p className="text-xs text-center text-muted-foreground">
                            By creating an account, you agree to our Terms of Service and Privacy Policy.
                        </p>
                    </form>
                </Card>
            </div>
        </div>
    )
}