'use client';
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { OutfitCard } from "@/components/recommendation/OutfitCard";
import { MapPin } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-3xl">Command Center</h1>
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="w-4 h-4" />
            <input
              type="text"
              defaultValue="St. Petersburg, FL"
              className="bg-transparent border-none outline-none"
            />
          </div>
        </div>

        {/* Run Type Selector */}
        <div className="flex gap-3">
          <Button variant="default" className="bg-[#10B981] hover:bg-[#059669] text-white">
            Easy
          </Button>
          <Button variant="outline">Long</Button>
          <Button variant="outline">Intervals</Button>
        </div>

        {/* Primary Recommendation Card */}
        <OutfitCard 
          title="Recommended Outfit for Today"
          tags={[
            { label: "Hot", tone: "weather" },
            { label: "Tempo Run", tone: "workout" },
            { label: "Lightweight", tone: "attribute" }
          ]}
          items={[
            {
              id: "lightweight-tank",
              label: "Lightweight Tank",
              category: "Top",
              description: "Open-knit singlet for heat release.",
              attributes: ["breathable", "no chafe"],
              icon: "👕"
            },
            {
              id: "split-shorts",
              label: "Split Shorts",
              category: "Bottom",
              description: "Short inseam keeps stride unrestricted",
              attributes: ["relaxed fit", "quick dry"],
              icon: "🩳"
            },
            {
              id: "performance-cap",
              label: "Performance Cap",
              category: "Accessories",
              description: "Shields sun without trapping heat",
              attributes: ["packable", "sweat-wicking"],
              icon: "🧢"
            },
          ]}
          attributes={[
            { label: "Breathability", value: "High airflow fabric" },
            { label: "Layering", value: "Single-layer heat setup" },
            { label: "Fit", value: "Trim top, free-moving bottom" },
          ]}
          why="Built for warm tempo miles with minimal layering, fast-drying pieces, and a cap for sun control"
          onSave={(outfit) => console.log("Save outfit", outfit)}
          onViewDetails={(outfit) => console.log("View outfit details", outfit)}
        />
        
        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="p-4">
            <div className="text-2xl">12</div>
            <div className="text-sm text-muted-foreground">Saved Outfits</div>
          </Card>
          <Card className="p-4">
            <div className="text-2xl">5</div>
            <div className="text-sm text-muted-foreground">Brands Tracked</div>
          </Card>
          <Card className="p-4">
            <div className="text-2xl">98%</div>
            <div className="text-sm text-muted-foreground">Accuracy</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
