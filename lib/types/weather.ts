// lib/types/weather.ts
export interface Weather {
    id: string;
    location: string;
    latitude: number;
    longitude: number;
    temperature: number;
    humidity: number;
    windSpeed: number;
    precipitationChance: number;
    uvIndex: number;
    condition: string;
    tempCategory: string;
    createdAt: Date;
    updatedAt: Date;
};