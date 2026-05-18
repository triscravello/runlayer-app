import type { UserProfile } from "@/lib/types/user";

type UserStoreState = {
    profile: UserProfile | null;
    isAuthenticated: boolean;
}

type UserStoreListener = (state: UserStoreState) => void;

const listeners = new Set<UserStoreListener>();

let state: UserStoreState = {
    profile: null,
    isAuthenticated: false,
};

function notify(): void {
    for (const listener of listeners) {
        listener(state);
    }
}

export const userStore = {
    getState(): UserStoreState {
        return state;
    },
    setProfile(profile: UserProfile | null): void {
        state = {
            ...state,
            profile,
            isAuthenticated: Boolean(profile),
        };
        notify();
    },
    reset(): void {
        state = {
            profile: null,
            isAuthenticated: false,
        }; 
        notify();
    },
    subscribe(listener: UserStoreListener): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export type { UserStoreState, UserStoreListener };