// app/api/gear/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        const gear = await prisma.gearItem.findMany();
        return NextResponse.json(gear, { status: 200 });
    } catch (error) {
        console.error("Error fetching gear:", error);
        return NextResponse.json({ error: "Failed to fetch gear" }, { status: 500 })
    }
};

export async function POST(request: Request) {
    try {
        const data = await request.json();
        const newGear = await prisma.gearItem.create({
            data: {
                name: data.name,
                brand: data.brand,
                genderTarget: data.genderTarget,
                category: data.category,
                subcategory: data.subcategory,
                priceRange: data.priceRange,
                tags: data.tags,
                weatherSuitability: data.weatherSuitability,
                bodyTypeFit: data.bodyTypeFit,
                imageUrl: data.imageUrl,
                affiliateUrl: data.affiliateUrl
            }
        });

        return NextResponse.json(newGear, { status: 201 });
    } catch (error) {
        console.error("Error creating gear:", error);
        return NextResponse.json({ error: "Failed to create gear" }, { status: 500 });
    }
};

export async function DELETE(request: Request) {
    try {
        const { id } = await request.json();
        await prisma.gearItem.delete({
            where: { id }
        });

        return NextResponse.json({ message: "Gear deleted successfully" }, { status: 200 });
    } catch (error) {
        console.error("Error deleting gear:", error);
        return NextResponse.json({ error: "Failed to delete gear" }, { status: 500 });
    }
};

export async function PUT(request: Request) {
    try {
        const data = await request.json();
        const updatedGear = await prisma.gearItem.update({
            where: { id: data.id },
            data: {
                name: data.name,
                brand: data.brand,
            }
        });

        return NextResponse.json(updatedGear, { status: 200 });
    } catch (error) {
        console.error("Error updating gear:", error);
        return NextResponse.json({ error: "Failed to update gear" }, { status: 500 });
    }
};

export async function PATCH(request: Request) {
    try {
        const data = await request.json();
        const updatedGear = await prisma.gearItem.update({
            where: { id: data.id },
            data: {
                name: data.name,
                brand: data.brand,
            }
        });

        return NextResponse.json(updatedGear, { status: 200 });
    } catch (error) {
        console.error("Error patching gear:", error);
        return NextResponse.json({ error: "Failed to patch gear" }, { status: 500 });
    }
};