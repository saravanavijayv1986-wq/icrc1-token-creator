import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { handleApiError, withErrorHandling, withRetry, AppError } from "./errorHandling";
import { toast } from "@/components/ui/use-toast";

// Mock the toast function
vi.mock("@/components/ui/use-toast", () => ({
  toast: vi.fn(),
}));

describe("Error Handling Utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("handleApiError", () => {
    test("should handle API response errors", () => {
      const apiError = {
        response: {
          data: {
            code: "VALIDATION_ERROR",
            message: "Invalid input data",
            details: { field: "symbol" },
          },
        },
      };

      expect(() => handleApiError(apiError)).toThrow(AppError);
      expect(toast).toHaveBeenCalledWith({
        title: "Error",
        description: "Please check your input and try again.",
        variant: "destructive",
      });
    });

    test("should handle generic Error objects", () => {
      const error = new Error("Network connection failed");

      expect(() => handleApiError(error)).toThrow(AppError);
      expect(toast).toHaveBeenCalledWith({
        title: "Error",
        description: "Network connection failed",
        variant: "destructive",
      });
    });

    test("should handle unknown error types", () => {
      const unknownError = "String error";

      expect(() => handleApiError(unknownError)).toThrow(AppError);
      expect(toast).toHaveBeenCalledWith({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    });

    test("should provide user-friendly messages for known error codes", () => {
      const testCases = [
        {
          code: "RATE_LIMIT_EXCEEDED",
          expected: "Too many requests. Please wait a moment and try again.",
        },
        {
          code: "INSUFFICIENT_FUNDS",
          expected: "Insufficient funds for this operation.",
        },
        {
          code: "INVALID_DELEGATION",
          expected: "Authentication expired. Please reconnect your wallet.",
        },
        {
          code: "UNKNOWN_ERROR_CODE",
          expected: "Original error message",
        },
      ];

      testCases.forEach(({ code, expected }) => {
        const apiError = {
          response: {
            data: {
              code,
              message: "Original error message",
            },
          },
        };

        expect(() => handleApiError(apiError)).toThrow(AppError);
        expect(toast).toHaveBeenCalledWith({
          title: "Error",
          description: expected,
          variant: "destructive",
        });
      });
    });
  });

  describe("withErrorHandling", () => {
    test("should pass through successful results", async () => {
      const successfulFunction = vi.fn().mockResolvedValue("success");
      const wrappedFunction = withErrorHandling(successfulFunction);

      const result = await wrappedFunction("arg1", "arg2");

      expect(result).toBe("success");
      expect(successfulFunction).toHaveBeenCalledWith("arg1", "arg2");
      expect(toast).not.toHaveBeenCalled();
    });

    test("should handle and transform errors", async () => {
      const failingFunction = vi.fn().mockRejectedValue(new Error("Function failed"));
      const wrappedFunction = withErrorHandling(failingFunction);

      await expect(wrappedFunction()).rejects.toThrow(AppError);
      expect(toast).toHaveBeenCalledWith({
        title: "Error",
        description: "Function failed",
        variant: "destructive",
      });
    });

    test("should preserve function signature", async () => {
      const typedFunction = (a: string, b: number): Promise<boolean> => 
        Promise.resolve(a.length > b);
      
      const wrappedFunction = withErrorHandling(typedFunction);

      const result = await wrappedFunction("test", 3);
      expect(result).toBe(true);
    });
  });

  describe("withRetry", () => {
    test("should succeed on first attempt", async () => {
      const successfulOperation = vi.fn().mockResolvedValue("success");

      const result = await withRetry(successfulOperation);

      expect(result).toBe("success");
      expect(successfulOperation).toHaveBeenCalledTimes(1);
    });

    test("should retry on failure and eventually succeed", async () => {
      const retriableOperation = vi.fn()
        .mockRejectedValueOnce(new Error("First failure"))
        .mockRejectedValueOnce(new Error("Second failure"))
        .mockResolvedValue("success");

      const result = await withRetry(retriableOperation, 3, 10); // 10ms delay for testing

      expect(result).toBe("success");
      expect(retriableOperation).toHaveBeenCalledTimes(3);
    });

    test("should fail after max retries", async () => {
      const alwaysFailingOperation = vi.fn().mockRejectedValue(new Error("Always fails"));

      await expect(withRetry(alwaysFailingOperation, 2, 10)).rejects.toThrow("Always fails");
      expect(alwaysFailingOperation).toHaveBeenCalledTimes(2);
    });

    test("should use default retry parameters", async () => {
      const failingOperation = vi.fn().mockRejectedValue(new Error("Default retry test"));

      await expect(withRetry(failingOperation)).rejects.toThrow("Default retry test");
      expect(failingOperation).toHaveBeenCalledTimes(3); // Default maxRetries
    });

    test("should implement exponential backoff", async () => {
      const failingOperation = vi.fn().mockRejectedValue(new Error("Backoff test"));
      const startTime = Date.now();

      await expect(withRetry(failingOperation, 3, 10)).rejects.toThrow();

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // With delays of 10ms, 20ms, should take at least 30ms
      expect(totalTime).toBeGreaterThan(25);
    });
  });

  describe("AppError", () => {
    test("should create error with all properties", () => {
      const error = new AppError("TEST_CODE", "Test message", { extra: "data" });

      expect(error.name).toBe("AppError");
      expect(error.code).toBe("TEST_CODE");
      expect(error.message).toBe("Test message");
      expect(error.details).toEqual({ extra: "data" });
    });

    test("should be instanceof Error", () => {
      const error = new AppError("TEST_CODE", "Test message");

      expect(error instanceof Error).toBe(true);
      expect(error instanceof AppError).toBe(true);
    });
  });

  describe("Integration", () => {
    test("should combine withErrorHandling and withRetry", async () => {
      const retriableFailingFunction = vi.fn()
        .mockRejectedValueOnce(new Error("First attempt"))
        .mockResolvedValue("success");

      const wrappedFunction = withErrorHandling(
        (arg: string) => withRetry(() => retriableFailingFunction(arg), 2, 10)
      );

      const result = await wrappedFunction("test");

      expect(result).toBe("success");
      expect(retriableFailingFunction).toHaveBeenCalledTimes(2);
      expect(toast).not.toHaveBeenCalled(); // No error should reach error handler
    });

    test("should handle retry exhaustion with error handling", async () => {
      const alwaysFailingFunction = vi.fn().mockRejectedValue(new Error("Persistent failure"));

      const wrappedFunction = withErrorHandling(
        () => withRetry(alwaysFailingFunction, 2, 10)
      );

      await expect(wrappedFunction()).rejects.toThrow(AppError);
      expect(alwaysFailingFunction).toHaveBeenCalledTimes(2);
      expect(toast).toHaveBeenCalledWith({
        title: "Error",
        description: "Persistent failure",
        variant: "destructive",
      });
    });
  });
});
