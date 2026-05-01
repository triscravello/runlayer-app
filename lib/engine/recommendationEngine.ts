export type UserInput = {
    weather?: string;
    workoutType?: string;
    intensity?: string;
    gender?: string;
    category?: string;
};

export type GearItem = {
    category?: string | null;
    weatherSuitability: Record<string, number> | null;
    tags: string[];
    genderTarget: string | null;
}

export type RankedGearItem = {
    item: GearItem;
    score: number;
    reasons: string[];
};

export function scoreGear(userInput: UserInput, gearItem: GearItem): RankedGearItem {
    let score = 0;
    const reasons: string[] = [];

    // WEATHER
    if (userInput.weather && gearItem.weatherSuitability) {
        const weatherScore = gearItem.weatherSuitability[userInput.weather];

        if (typeof weatherScore === "number") {
            score += weatherScore * 3;
            reasons.push(`Fits ${userInput.weather} conditions`);
        }
    }

    // WORKOUT
    const normalize = (s: string) =>
        s.toLowerCase().replace(/[-_\s]/g, "");

    const workout = userInput.workoutType;

    if (workout) {
        const match = gearItem.tags.some((tag) =>
            normalize(tag).includes(normalize(workout))
        );

        if (match) {
            score += 3;
            reasons.push(`Designed for ${workout} runs`);
        }
    }

    // INTENSITY
    if (userInput.intensity === "high" && gearItem.tags.includes("race-day")) {
        score += 2;
        reasons.push("Great for high-intensity race efforts");
    }

    // GENDER (soft logic)
    if (userInput.gender) {
        if (gearItem.genderTarget === userInput.gender) {
            score += 2;
            reasons.push("Matches your fit preference");
        } else if (gearItem.genderTarget === "unisex") {
            score += 1;
            reasons.push("Unisex fit");
        }
    }

    return { item: gearItem, score, reasons };
}

export function rankGearList(userInput: UserInput, gearItems: GearItem[]): RankedGearItem[] {
    return gearItems.map((gearItem) => scoreGear(userInput, gearItem)).sort((a, b) => b.score - a.score)
}

export function filterByCategory(
    gearItems: GearItem[],
    category?: string,
): GearItem[] {
    if (!category) {
        return gearItems;
    }

    const normalizedCategory = category.toLowerCase();
    return gearItems.filter((gearItem) =>
        gearItem.category?.toLowerCase() === normalizedCategory,
    );
}