type TemperatureUnit = "C" | "F";

type PreferenceState = {
    temperatureUnit: TemperatureUnit;
    favoriteBrandIds: string[];
};

type PreferenceListener = (state: PreferenceState) => void;

const listeners = new Set<PreferenceListener>();

let state: PreferenceState = {
    temperatureUnit: "F",
    favoriteBrandIds: [],
};

function notify(): void {
    for (const listener of listeners) {
        listener(state);
    }
}

export const preferenceStore = {
    getState(): PreferenceState {
        return state;
    },
    setTemperatureUnit(temperatureUnit: TemperatureUnit): void {
        state = {
            ...state,
            temperatureUnit,
        };
        notify();
    },
    setFavoriteBrandIds(favoriteBrandIds: string[]): void {
        state = {
            ...state,
            favoriteBrandIds: [...favoriteBrandIds],
        };
        notify();
    },
    subscribe(listener: PreferenceListener): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export type { PreferenceState, PreferenceListener, TemperatureUnit };