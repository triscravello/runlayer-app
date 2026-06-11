"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AuthUser = {
    id: string;
    email: string;
    username: string;
    role: "USER" | "ADMIN";
    location: string | null;
};

type AuthContextType = {
    user: AuthUser | null;
    loading: boolean;
    setUser: (user: AuthUser | null) => void;
    checkAuth: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);

    const checkAuth = useCallback(async () => {
        setLoading(true);

        try {
            const response = await fetch("/api/auth", {
                method: "GET",
                credentials: "include",
            });

            if (!response.ok) {
                setUser(null);
                return;
            }

            const data = (await response.json() as { authenticated: boolean, user?: AuthUser });

            if (data.authenticated && data.user) {
                setUser(data.user);
            } else {
                setUser(null);
            }
        } catch {
            setUser(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void Promise.resolve().then(checkAuth);
    }, [checkAuth]);

    const value = useMemo(
        () => ({ user, loading, setUser, checkAuth }),
        [user, loading, checkAuth],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
    const context = useContext(AuthContext);

    if (!context) {
        throw new Error("useAuth must be used with AuthProvider");
    }

    return context;
}