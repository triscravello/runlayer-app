// lib/types/gear.ts
export interface Gear {
    id: number;
    name: string;
    brand: string;
    category: string;
    subcategory: string;
    priceRange: string;
    tags: string[];
    weatherSuitability: string[];
    bodyTypeFit: string[];
    imageUrl: string;
    affiliateUrl: string;
    createdAt: Date;
    updatedAt: Date;
};

export interface Brand {
    id: number;
    name: string;
    tier: string;
    style: string;
    createdAt: Date;
    updatedAt: Date;
}