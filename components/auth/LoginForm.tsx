"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authService } from "@/services/authService";
import { useAuth } from "@/context/authContext";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";

export default function LoginForm() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const router = useRouter();
    const { setUser } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        setError("");
        setSuccessMessage("");

        if (!username.trim() || !password.trim()) {
            setError('Username and password are required');
            return;
        }
        setIsSubmitting(true);

        try {
            const result = await authService.login({ username, password });
            setUser(result.data.user);
            setSuccessMessage("Logged in successfully. Redirecting...");
            router.push("/dashboard");
            router.refresh();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Login failed. Please try again.";
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <div className="flex items-center justify-center px-4 py-12 md:py-20">
            <div className="w-full max-w-md space-y-8">
                <h1 className="text-3xl md:text-4xl mb-3">Log In</h1>
            </div>

            <Card className="p-8">
                <form onSubmit={handleSubmit} className="space-y-6">
                    {error && <p className="text-red-500 mb-4">{error}</p>}
                    {successMessage && <p className="text-emerald-600 mb-4">{successMessage}</p>}
                    <div className="space-y-2">
                        <Label htmlFor="username">Username</Label>
                        <Input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} required className="bg-input-background" />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="bg-input-background" />
                    </div>

                    <Button type="submit" disabled={isSubmitting} className="w-full bg-[#10B981] hover:bg[#059669] text-white h-12">{isSubmitting ? "Logging in..." : "Log In"}</Button>
                </form>
            </Card>
        </div>
    );
}