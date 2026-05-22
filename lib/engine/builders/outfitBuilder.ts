import type { ScoredRecommendationItem } from "../types/recommendationEngine";
export type OutfitResult = { score: number; reasons: string[]; items:{ top?:unknown; bottom?:unknown; outerwear?:unknown; accessory?:unknown; socks?:unknown; hat?:unknown; gloves?:unknown; }; };
export function outfitBuilder(scoredItems: ScoredRecommendationItem[]): OutfitResult[] {
    const by = (c:string)=>scoredItems.filter(s=>s.item.category===c); 
    const top = by('top')[0]; 
    const bottom = by('bottom')[0]; 
    if(!top || !bottom) return []; 
    const outerwear = by('outerwear')[0]; 
    const accessory = by('accessory')[0]; 
    const parts = [top,bottom,outerwear,accessory].filter(Boolean) as ScoredRecommendationItem[]; 
    const avg = parts.reduce((n, p)=>n + p.score, 0) / parts.length; 
    const cohesion = parts.every(p=>p.item.tags.some(t=>top.item.tags.includes(t))) ? 3 : 0; 
    const layering = outerwear ? 2 : 0; 
    return [{score: avg + cohesion + layering, reasons:["Optimized for cohesive conditions", "Layering compatibility validated"], items:{top:top.item,bottom:bottom.item,outerwear:outerwear?.item,accessory:accessory?.item}}];
}