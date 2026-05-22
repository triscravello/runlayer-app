import type { ScoredRecommendationItem } from "../types/recommendationEngine";
export function recommendationExplainer(scored: ScoredRecommendationItem): string[] { 
    return Object.entries(scored.contributions).filter(([,v])=>v!==0).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v>0?'boosted':'penalized'} this item (${v>0?'+':''}${v})`); 
}