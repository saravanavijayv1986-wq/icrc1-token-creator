import { CheckCircle } from "lucide-react";

export function DeploySuccess({ canisterId }: { canisterId: string }) {
  return (
    <div className="text-center space-y-4">
      <CheckCircle className="mx-auto text-green-500 w-16 h-16" />
      <h2 className="text-xl font-bold">Token Deployed!</h2>
      <p className="text-gray-600">Your new ledger canister is live on ICP.</p>
      <div className="bg-gray-100 rounded-lg p-3 flex items-center justify-between">
        <span className="font-mono text-sm break-all">{canisterId}</span>
        <button
          onClick={() => navigator.clipboard.writeText(canisterId)}
          className="text-blue-600 text-sm font-medium"
        >
          Copy
        </button>
      </div>
    </div>
  );
}
