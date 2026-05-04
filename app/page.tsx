import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ArrowRight, Zap, Target, Brain, TrendingUp } from "lucide-react";

interface HomePageProps {
  onGetStarted: () => void;
}

export default function HomePage({ onGetStarted }: HomePageProps) {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Navigation Bar */}
        <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 md:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-[#10B981] rounded-lg flex items-center justify-center">
                  <span className="text-white text-xl">⚡</span>
                </div>
                <span className="text-xl">RunLayer</span>
              </div>
              <Button
                onClick={onGetStarted}
                className="bg-[#10B981] hover:bg-[#059669] text-white"
              >
                Get Started
              </Button>
            </div>
          </div>
        </nav>

        {/* Hero Content */}
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-20 md:py-32">
          <div className="max-w-4xl mx-auto text-center space-y-8">
            <Badge
              variant="outline"
              className="px-4 py-2 bg-[#10B981]/10 border-[#10B981]/20 text-[#10B981]"
            >
              Performance Intelligence Platform
            </Badge>

            <h1 className="text-5xl md:text-6xl lg:text-7xl">
              The Running Gear
              <br />
              Recommendation Engine
            </h1>

            <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              AI-powered outfit optimization based on real conditions, personal physiology,
              and performance science. Know exactly what to wear before every run.
            </p>

            <div className="flex gap-4 justify-center pt-4">
              <Button
                onClick={onGetStarted}
                className="bg-[#10B981] hover:bg-[#059669] text-white text-lg px-8 py-6 h-auto"
              >
                Start Optimizing
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Button variant="outline" className="text-lg px-8 py-6 h-auto">
                See How It Works
              </Button>
            </div>

            {/* Quick Stats */}
            <div className="flex gap-8 justify-center pt-12 text-center">
              <div>
                <div className="text-3xl mb-1">98%</div>
                <div className="text-sm text-muted-foreground">Accuracy</div>
              </div>
              <div className="w-px bg-border" />
              <div>
                <div className="text-3xl mb-1">12k+</div>
                <div className="text-sm text-muted-foreground">Recommendations</div>
              </div>
              <div className="w-px bg-border" />
              <div>
                <div className="text-3xl mb-1">24/7</div>
                <div className="text-sm text-muted-foreground">Live Weather</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works Section */}
      <div className="bg-muted/30 py-20 md:py-32">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl mb-4">Data-Driven Performance Intelligence</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Four integrated systems working together to compute your optimal gear
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Recommendation Engine */}
            <Card className="p-8 hover:shadow-xl transition-shadow">
              <div className="w-12 h-12 bg-[#10B981]/10 rounded-lg flex items-center justify-center mb-4">
                <Brain className="w-6 h-6 text-[#10B981]" />
              </div>
              <h3 className="text-2xl mb-3">Recommendation Engine</h3>
              <p className="text-muted-foreground leading-relaxed">
                AI reasoning that analyzes temperature, humidity, wind, run type, and personal
                physiology to compute optimal outfit configurations. Every recommendation
                includes transparent logic explaining exactly why each piece was selected.
              </p>
            </Card>

            {/* Weather Service */}
            <Card className="p-8 hover:shadow-xl transition-shadow">
              <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center mb-4">
                <Target className="w-6 h-6 text-blue-500" />
              </div>
              <h3 className="text-2xl mb-3">Weather Intelligence</h3>
              <p className="text-muted-foreground leading-relaxed">
                Real-time environmental data processing that goes beyond basic forecasts.
                Analyzes heat index, evaporative cooling efficiency, and wind chill to
                determine actual performance impact on your body.
              </p>
            </Card>

            {/* Gear Repository */}
            <Card className="p-8 hover:shadow-xl transition-shadow">
              <div className="w-12 h-12 bg-orange-500/10 rounded-lg flex items-center justify-center mb-4">
                <Zap className="w-6 h-6 text-orange-500" />
              </div>
              <h3 className="text-2xl mb-3">Gear Database</h3>
              <p className="text-muted-foreground leading-relaxed">
                Curated performance database with technical specifications, material properties,
                and real-world testing data. Each item tagged with functional characteristics:
                moisture transfer rates, friction coefficients, thermal regulation scores.
              </p>
            </Card>

            {/* Brand Mapper */}
            <Card className="p-8 hover:shadow-xl transition-shadow">
              <div className="w-12 h-12 bg-purple-500/10 rounded-lg flex items-center justify-center mb-4">
                <TrendingUp className="w-6 h-6 text-purple-500" />
              </div>
              <h3 className="text-2xl mb-3">Brand Intelligence</h3>
              <p className="text-muted-foreground leading-relaxed">
                Athletic ecosystem mapping across Nike, Bandit, Tracksmith, Lululemon, and more.
                Matches brand strengths to specific conditions: Nike for moisture management,
                Bandit for split shorts, Tracksmith for ventilation engineering.
              </p>
            </Card>
          </div>
        </div>
      </div>

      {/* The Difference Section */}
      <div className="py-20 md:py-32">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-4xl mb-4">Not a Shopping App. An Intelligence System.</h2>
              <p className="text-xl text-muted-foreground">
                RunLayer computes what you should wear based on science, not preference
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Traditional Apps */}
              <Card className="p-6 border-2 border-destructive/20">
                <div className="text-sm text-destructive mb-3">Traditional Apps</div>
                <ul className="space-y-3">
                  <li className="flex items-start gap-2 text-muted-foreground">
                    <span className="text-destructive">✗</span>
                    <span>Generic "outfit of the day" suggestions</span>
                  </li>
                  <li className="flex items-start gap-2 text-muted-foreground">
                    <span className="text-destructive">✗</span>
                    <span>Shopping catalog with filters</span>
                  </li>
                  <li className="flex items-start gap-2 text-muted-foreground">
                    <span className="text-destructive">✗</span>
                    <span>Basic weather widget integration</span>
                  </li>
                  <li className="flex items-start gap-2 text-muted-foreground">
                    <span className="text-destructive">✗</span>
                    <span>No reasoning or explanation</span>
                  </li>
                </ul>
              </Card>

              {/* RunLayer */}
              <Card className="p-6 border-2 border-[#10B981]/20 bg-[#10B981]/5">
                <div className="text-sm text-[#10B981] mb-3">RunLayer</div>
                <ul className="space-y-3">
                  <li className="flex items-start gap-2">
                    <span className="text-[#10B981]">✓</span>
                    <span>Calculated recommendations based on conditions</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#10B981]">✓</span>
                    <span>Performance database, not product listings</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#10B981]">✓</span>
                    <span>Environmental intelligence with impact analysis</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#10B981]">✓</span>
                    <span>Transparent AI reasoning for every choice</span>
                  </li>
                </ul>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {/* Example Reasoning Section */}
      <div className="bg-gradient-to-br from-amber-50 to-background py-20 md:py-32">
        <div className="max-w-4xl mx-auto px-4 md:px-8">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Example Intelligence</Badge>
            <h2 className="text-4xl mb-4">See The System Think</h2>
          </div>

          <Card className="p-8 border-2 border-amber-200">
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-border">
                <div>
                  <div className="text-sm text-muted-foreground">Conditions</div>
                  <div>72°F · 65% humidity · Easy run</div>
                </div>
                <Badge className="bg-[#10B981] text-white">Optimized</Badge>
              </div>

              <div>
                <h4 className="mb-2 text-amber-900">Weather Logic</h4>
                <p className="text-sm leading-relaxed text-foreground/90">
                  At 72°F with 65% humidity, your body's cooling efficiency drops by
                  approximately 20%. The tank top configuration maximizes skin exposure for
                  evaporative cooling, while mesh panels create convective airflow channels.
                </p>
              </div>

              <div>
                <h4 className="mb-2 text-amber-900">Physiology Logic</h4>
                <p className="text-sm leading-relaxed text-foreground/90">
                  High humidity increases chafing risk during long runs. Lightweight split
                  shorts reduce friction and improve airflow, while moisture-wicking fabric
                  prevents heat buildup.
                </p>
              </div>

              <div className="pt-4 border-t border-border text-center">
                <p className="text-sm text-muted-foreground italic">
                  "This system actually knows what I should wear better than I do."
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* CTA Section */}
      <div className="py-20 md:py-32">
        <div className="max-w-4xl mx-auto px-4 md:px-8 text-center">
          <h2 className="text-4xl md:text-5xl mb-6">
            Stop guessing. Start optimizing.
          </h2>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Get personalized gear recommendations powered by real-time conditions and
            performance science.
          </p>
          <Button
            onClick={onGetStarted}
            className="bg-[#10B981] hover:bg-[#059669] text-white text-lg px-10 py-6 h-auto"
          >
            Start Your First Recommendation
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-12">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-[#10B981] rounded flex items-center justify-center">
                <span className="text-white text-sm">⚡</span>
              </div>
              <span>RunLayer</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Performance Intelligence Platform · 2026
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}