import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, Shield, Zap, Eye, CheckCircle, ArrowRight } from "lucide-react";

export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-8">
      {/* Hero Section */}
      <section className="text-center py-16">
        <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
          Create ICRC-1 Tokens in Minutes
        </h1>
        <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
          Enterprise-grade token creation on the Internet Computer. Deploy compliant, 
          auditable ICRC-1 tokens with our professional platform.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button asChild size="lg" className="text-lg px-8 py-6">
            <Link to="/create">
              Create Your Token
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="text-lg px-8 py-6">
            <Link to="/dashboard">View Tokens</Link>
          </Button>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16">
        <h2 className="text-3xl font-bold text-center mb-12">Why Choose TokenForge?</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="text-center">
            <CardHeader>
              <Zap className="h-12 w-12 text-primary mx-auto mb-4" />
              <CardTitle>Lightning Fast</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Deploy your ICRC-1 token in under 3 minutes with our streamlined process.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="text-center">
            <CardHeader>
              <Shield className="h-12 w-12 text-primary mx-auto mb-4" />
              <CardTitle>Enterprise Grade</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Built with security and compliance in mind. Fully auditable and transparent.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="text-center">
            <CardHeader>
              <Eye className="h-12 w-12 text-primary mx-auto mb-4" />
              <CardTitle>Full Transparency</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                All token creations are logged publicly. Complete audit trail included.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="text-center">
            <CardHeader>
              <Coins className="h-12 w-12 text-primary mx-auto mb-4" />
              <CardTitle>ICRC-1 Standard</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Fully compliant with the official ICRC-1 fungible token standard.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Process Section */}
      <section className="py-16">
        <h2 className="text-3xl font-bold text-center mb-12">Simple 3-Step Process</h2>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-2xl font-bold mx-auto mb-4">
              1
            </div>
            <h3 className="text-xl font-semibold mb-2">Configure Token</h3>
            <p className="text-muted-foreground">
              Set your token name, symbol, supply, and upload a logo. Our form guides you through the process.
            </p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-2xl font-bold mx-auto mb-4">
              2
            </div>
            <h3 className="text-xl font-semibold mb-2">Pay & Deploy</h3>
            <p className="text-muted-foreground">
              Pay the deployment fee in ICP. Your token canister is automatically deployed to the IC.
            </p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-2xl font-bold mx-auto mb-4">
              3
            </div>
            <h3 className="text-xl font-semibold mb-2">Manage & Trade</h3>
            <p className="text-muted-foreground">
              Access your dashboard to mint, burn, transfer tokens, and view all transaction history.
            </p>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 bg-muted rounded-lg">
        <h2 className="text-3xl font-bold text-center mb-12">Platform Statistics</h2>
        <div className="grid md:grid-cols-4 gap-6 text-center">
          <div>
            <div className="text-4xl font-bold text-primary mb-2">1,247</div>
            <div className="text-muted-foreground">Tokens Created</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-primary mb-2">$2.3M</div>
            <div className="text-muted-foreground">Total Value Locked</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-primary mb-2">45s</div>
            <div className="text-muted-foreground">Avg Deploy Time</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-primary mb-2">99.9%</div>
            <div className="text-muted-foreground">Uptime</div>
          </div>
        </div>
      </section>

      {/* Features List */}
      <section className="py-16">
        <h2 className="text-3xl font-bold text-center mb-12">Complete Feature Set</h2>
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {[
            "ICRC-1 Standard Compliance",
            "Custom Token Metadata",
            "Logo Upload & Storage",
            "Mint & Burn Controls",
            "Transfer Management",
            "Transaction History",
            "Public Audit Trail",
            "Multi-Wallet Support",
            "Canister Management",
            "Fee Transparency",
            "Real-time Updates",
            "Export Capabilities"
          ].map((feature) => (
            <div key={feature} className="flex items-center space-x-3">
              <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
              <span>{feature}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 text-center">
        <h2 className="text-3xl font-bold mb-6">Ready to Launch Your Token?</h2>
        <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
          Join thousands of projects that have chosen TokenForge for their token deployment needs.
        </p>
        <Button asChild size="lg" className="text-lg px-8 py-6">
          <Link to="/create">
            Get Started Now
            <ArrowRight className="ml-2 h-5 w-5" />
          </Link>
        </Button>
      </section>
    </div>
  );
}
