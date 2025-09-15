import { Link, useLocation } from "react-router-dom";
import { Coins } from "lucide-react";

export function Sidebar() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const linkClass = (path: string) =>
    `block px-4 py-2 rounded hover:bg-blue-50 ${isActive(path) ? 'text-blue-600 font-semibold' : 'text-gray-700'}`;
  return (
    <aside className="w-48 p-4 border-r bg-white hidden md:block">
      <div className="flex items-center mb-6 space-x-2">
        <Coins className="h-6 w-6 text-blue-600" />
        <span className="font-bold">TokenForge</span>
      </div>
      <nav className="space-y-1 text-sm">
        <Link to="/create" className={linkClass('/create')}>Create Token</Link>
        <Link to="/dashboard" className={linkClass('/dashboard')}>My Tokens</Link>
        <a href="https://internetcomputer.org/docs" className={linkClass('#')}>Docs</a>
      </nav>
    </aside>
  );
}
