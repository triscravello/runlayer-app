// lib/types/weather.ts
export interface Weather {
    id: number;
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