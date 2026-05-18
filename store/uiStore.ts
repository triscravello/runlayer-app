type NotificationKind = "success" | "error" | "info";

type Notification = {
  id: string;
  message: string;
  kind: NotificationKind;
};

type UIState = {
    isSidebarOpen: boolean;
    notifications: Notification[];
}

type UIListener = (state: UIState) => void;

const listeners = new Set<UIListener>();

let state: UIState = {
    isSidebarOpen: false,
    notifications: [],
};

function notify(): void {
    for (const listener of listeners) {
        listener(state);
    }
}

export const uiStore = {
    getState(): UIState {
        return state;
    },
    setSidebarOpen(isSidebarOpen: boolean): void {
        state = {
            ...state,
            isSidebarOpen,
        };
        notify();
    },
    pushNotification(notification: Omit<Notification, "id">): string {
        const id = crypto.randomUUID();
        state = {
            ...state,
            notifications: [...state.notifications, { ...notification, id }],
        };
        notify();
        return id;
    },
    removeNotification(id: string): void {
        state = {
            ...state,
            notifications: state.notifications.filter((notification) => notification.id !== id),
        };
        notify();
    },
    clearNotifications(): void {
        state = {
            ...state,
            notifications: [],
        };
        notify();
    },
    subscribe(listener: UIListener): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export type { Notification, NotificationKind, UIState, UIListener };