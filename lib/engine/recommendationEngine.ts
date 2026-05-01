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
    const maxScore = 12;
    const reasons: string[] = [];

    if (userInput.weather && gearItem.weatherSuitability) {
        const weatherScore = gearItem.weatherSuitability[userInput.weather];
        if (typeof weatherScore === "number") {
            score += weatherScore * 5;
            reasons.push(`Fits ${userInput.weather} conditions`);
        } else {
            score -= 1;
        }
    }

    const normalizedWorkout = userInput.workoutType?.toLowerCase();
    if (normalizedWorkout) {
        const workoutMatch = gearItem.tags.some((tag) => 
            tag.toLowerCase().includes(normalizedWorkout),
        );
        
        if (workoutMatch) {
            score += 3;
            reasons.push(`Designed for ${userInput.workoutType} runs`);
        }
    }

    if (userInput.intensity === "high") {
        if (gearItem.tags.includes("race-day")) {
            score += 2;
            reasons.push("Great for race intensity");
        } else {
            score -= 0.5;
        }
    }

    if (userInput.gender) {
        if (gearItem.genderTarget === userInput.gender) {
            score += 2;
            reasons.push("Perfect for gender preference");
        } else if (gearItem.genderTarget === "unisex") {
            score += 1;
            reasons.push("Unisex fit");
        }
    }

    const finalScore = Math.max(0, Math.min(100, (score / maxScore) * 100));
    return { item: gearItem, score: finalScore, reasons };
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