import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Coins, Menu, Shield } from "lucide-react";
import WalletConnect from "./WalletConnect";
import { environment } from "../config";

export default function Header() {
  const location = useLocation();

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <header className="border-b bg-card sticky top-0 z-50 backdrop-blur-sm bg-card/95">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center space-x-2">
            <Coins className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold">TokenForge</span>
            {!environment.isProduction && (
              <Badge variant="outline" className="text-xs">
                {environment.isDevelopment ? 'DEV' : 'STAGING'}
              </Badge>
            )}
          </Link>
          
          <nav className="hidden md:flex items-center space-x-6">
            <Link 
              to="/" 
              className={`text-foreground hover:text-primary transition-colors ${
                isActive('/') ? 'text-primary font-medium' : ''
              }`}
            >
              Home
            </Link>
            <Link 
              to="/search" 
              className={`text-foreground hover:text-primary transition-colors ${
                isActive('/search') ? 'text-primary font-medium' : ''
              }`}
            >
              Explore
            </Link>
            <Link 
              to="/create" 
              className={`text-foreground hover:text-primary transition-colors ${
                isActive('/create') ? 'text-primary font-medium' : ''
              }`}
            >
              Create Token
            </Link>
            <Link 
              to="/dashboard" 
              className={`text-foreground hover:text-primary transition-colors ${
                isActive('/dashboard') ? 'text-primary font-medium' : ''
              }`}
            >
              Dashboard
            </Link>
            <Link 
              to="/analytics" 
              className={`text-foreground hover:text-primary transition-colors ${
                isActive('/analytics') ? 'text-primary font-medium' : ''
              }`}
            >
              Analytics
            </Link>
          </nav>

          <div className="flex items-center space-x-4">
            {environment.isProduction && (
              <div className="hidden sm:flex items-center space-x-1 text-xs text-muted-foreground">
                <Shield className="h-3 w-3 text-green-500" />
                <span>Production</span>
              </div>
            )}
            
            <WalletConnect />
            
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
