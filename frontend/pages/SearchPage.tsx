import TokenSearch from "../components/TokenSearch";

export default function SearchPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Token Explorer</h1>
        <p className="text-muted-foreground">
          Discover and explore ICRC-1 tokens on the Internet Computer.
        </p>
      </div>

      <TokenSearch />
    </div>
  );
}
