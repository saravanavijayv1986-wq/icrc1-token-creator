import { cn } from "@/lib/utils";

export function Stepper({ current }: { current: number }) {
  const steps = ["Token Info", "Supply & Fees", "Review", "Deploy"];
  return (
    <div className="flex justify-between mb-8">
      {steps.map((step, i) => (
        <div key={i} className="flex-1 text-center">
          <div
            className={cn(
              "rounded-full w-8 h-8 mx-auto flex items-center justify-center",
              i <= current ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600"
            )}
          >
            {i + 1}
          </div>
          <p className="text-sm mt-2">{step}</p>
        </div>
      ))}
    </div>
  );
}
