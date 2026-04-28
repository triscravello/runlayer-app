// lib/types/recommendation.ts
import { User } from "./user";
import { Weather } from "./weather";

export interface Recommendation {
    id: number;
    userId: User["id"];
    weather: Weather;
    inputContext: string;
    output: string;
    createdAt: Date;
    updatedAt: Date;
};

export interface UserSavedOutfits {
    id: number;
    userId: User["id"];
    recommendationId: Recommendation["id"];
    name: string;
    isFavorite: boolean;
    createdAt: Date;
    updatedAt: Date;
};

export interface RecommendationRules {
    id: number;
    conditionKey: string;
    category: string;
    weight: number;
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
};