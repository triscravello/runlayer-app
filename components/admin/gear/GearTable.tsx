"use client";

type GearTableItem = { id: string; name: string; category: string; priceRange: string };

export function GearTable({ items }: { items: GearTableItem [] }) {
    return <table><thead><tr><th>Name</th><th>Category</th><th>Price</th></tr></thead><tbody>{items.map((i)=><tr key={i.id}><td>{i.name}</td><td>{i.category}</td><td>{i.priceRange}</td></tr>)}</tbody></table>;
}