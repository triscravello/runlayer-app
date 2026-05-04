'use client';
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { MapPin, Cloud, Droplets, Wind } from "lucide-react";

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
              defaultValue="San Francisco, CA"
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
        <Card className="p-6 border-2 border-[#10B981]/20 shadow-lg">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2>Recommended Outfit for Today</h2>
              <div className="px-3 py-1 bg-[#10B981]/10 text-[#10B981] rounded-full text-sm">
                Optimized for conditions
              </div>
            </div>

            {/* Weather Summary */}
            <div className="flex gap-6 py-3 px-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <Cloud className="w-5 h-5 text-muted-foreground" />
                <div>
                  <div className="text-sm text-muted-foreground">Temperature</div>
                  <div>72°F</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Droplets className="w-5 h-5 text-muted-foreground" />
                <div>
                  <div className="text-sm text-muted-foreground">Humidity</div>
                  <div>65%</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Wind className="w-5 h-5 text-muted-foreground" />
                <div>
                  <div className="text-sm text-muted-foreground">Wind</div>
                  <div>8 mph</div>
                </div>
              </div>
            </div>

            {/* Outfit Preview */}
            <div className="grid grid-cols-3 gap-4 py-4">
              <div className="space-y-2">
                <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-4xl">👕</div>
                    <div className="text-sm text-muted-foreground mt-2">Top</div>
                  </div>
                </div>
                <div className="text-sm">
                  Lightweight Tank
                </div>
              </div>
              <div className="space-y-2">
                <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-4xl">🩳</div>
                    <div className="text-sm text-muted-foreground mt-2">Bottom</div>
                  </div>
                </div>
                <div className="text-sm">
                  Split Shorts
                </div>
              </div>
              <div className="space-y-2">
                <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-4xl">🧢</div>
                    <div className="text-sm text-muted-foreground mt-2">Accessories</div>
                  </div>
                </div>
                <div className="text-sm">
                  Performance Cap
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Button className="flex-1 bg-[#10B981] hover:bg-[#059669]">
                View Full Breakdown
              </Button>
              <Button variant="outline">Save Outfit</Button>
              <Button variant="outline">Adjust Preferences</Button>
            </div>
          </div>
        </Card>

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
