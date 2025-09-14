import { expect, test, describe } from "vitest";
import { 
  FormValidator, 
  validateTokenCreation, 
  validateTransfer, 
  validateTokenOperation,
  validationRules 
} from "./validation";

describe("Frontend Validation", () => {
  describe("FormValidator", () => {
    test("should validate required fields", () => {
      const validator = new FormValidator();
      
      validator
        .validateField("test", "value", { required: true })
        .validateField("empty", "", { required: true })
        .validateField("null", null, { required: true });

      const result = validator.getResult();
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toContain("empty is required");
      expect(result.errors).toContain("null is required");
    });

    test("should validate string length", () => {
      const validator = new FormValidator();
      
      validator
        .validateField("short", "ab", { minLength: 3 })
        .validateField("long", "verylongstring", { maxLength: 5 })
        .validateField("valid", "test", { minLength: 2, maxLength: 10 });

      const result = validator.getResult();
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.some(e => e.includes("short"))).toBe(true);
      expect(result.errors.some(e => e.includes("long"))).toBe(true);
    });

    test("should validate number ranges", () => {
      const validator = new FormValidator();
      
      validator
        .validateField("small", 5, { min: 10 })
        .validateField("large", 15, { max: 10 })
        .validateField("valid", 8, { min: 5, max: 10 });

      const result = validator.getResult();
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.some(e => e.includes("small"))).toBe(true);
      expect(result.errors.some(e => e.includes("large"))).toBe(true);
    });

    test("should validate patterns", () => {
      const validator = new FormValidator();
      
      validator
        .validateField("invalid", "test123!", { pattern: /^[a-zA-Z]+$/ })
        .validateField("valid", "test", { pattern: /^[a-zA-Z]+$/ });

      const result = validator.getResult();
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("invalid");
    });

    test("should validate custom rules", () => {
      const validator = new FormValidator();
      
      validator
        .validateField("odd", 3, { 
          custom: (value) => value % 2 === 0,
          message: "Must be even"
        })
        .validateField("even", 4, { 
          custom: (value) => value % 2 === 0,
          message: "Must be even"
        });

      const result = validator.getResult();
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBe("Must be even");
    });

    test("should skip validation for empty non-required fields", () => {
      const validator = new FormValidator();
      
      validator
        .validateField("optional", "", { minLength: 5 })
        .validateField("required", "", { required: true, minLength: 5 });

      const result = validator.getResult();
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("required is required");
    });

    test("should reset validator state", () => {
      const validator = new FormValidator();
      
      validator.validateField("test", "", { required: true });
      expect(validator.getResult().isValid).toBe(false);
      
      validator.reset();
      expect(validator.getResult().isValid).toBe(true);
      expect(validator.getResult().errors).toHaveLength(0);
    });
  });

  describe("Validation Rules", () => {
    test("should validate token names", () => {
      const rule = validationRules.tokenName;
      
      expect(rule.pattern!.test("Valid Token Name")).toBe(true);
      expect(rule.pattern!.test("Token-123_Test")).toBe(true);
      expect(rule.pattern!.test("Token@Invalid")).toBe(false);
      expect(rule.pattern!.test("Token#Invalid")).toBe(false);
    });

    test("should validate token symbols", () => {
      const rule = validationRules.tokenSymbol;
      
      expect(rule.pattern!.test("TEST")).toBe(true);
      expect(rule.pattern!.test("TOKEN123")).toBe(true);
      expect(rule.pattern!.test("test")).toBe(false); // must be uppercase
      expect(rule.pattern!.test("TO@KEN")).toBe(false);
    });

    test("should validate principals", () => {
      const rule = validationRules.principal;
      
      expect(rule.pattern!.test("rrkah-fqaaa-aaaah-qcuea-cai")).toBe(true);
      expect(rule.pattern!.test("rdmx6-jaaaa-aaaah-qca7q-cai")).toBe(true);
      expect(rule.pattern!.test("invalid-principal")).toBe(false);
      expect(rule.pattern!.test("too-short")).toBe(false);
    });

    test("should validate positive integers", () => {
      const rule = validationRules.totalSupply;
      
      expect(rule.custom!(1000000)).toBe(true);
      expect(rule.custom!(1)).toBe(true);
      expect(rule.custom!(0)).toBe(false);
      expect(rule.custom!(-1)).toBe(false);
      expect(rule.custom!(3.14)).toBe(false);
    });
  });

  describe("Token Creation Validation", () => {
    test("should validate complete token creation", () => {
      const validData = {
        tokenName: "Test Token",
        symbol: "TEST",
        totalSupply: "1000000",
        decimals: "8",
      };

      const result = validateTokenCreation(validData);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("should reject invalid token creation", () => {
      const invalidData = {
        tokenName: "", // too short
        symbol: "t", // too short and lowercase
        totalSupply: "0", // zero
        decimals: "25", // too high
      };

      const result = validateTokenCreation(invalidData);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("should validate token name constraints", () => {
      const testCases = [
        { name: "", valid: false }, // empty
        { name: "A", valid: false }, // too short
        { name: "Valid Token Name", valid: true },
        { name: "A".repeat(51), valid: false }, // too long
        { name: "Token@Invalid", valid: false }, // invalid characters
      ];

      testCases.forEach(({ name, valid }) => {
        const result = validateTokenCreation({
          tokenName: name,
          symbol: "TEST",
          totalSupply: "1000000",
          decimals: "8",
        });
        expect(result.isValid).toBe(valid);
      });
    });

    test("should validate symbol constraints", () => {
      const testCases = [
        { symbol: "", valid: false }, // empty
        { symbol: "T", valid: false }, // too short
        { symbol: "TEST", valid: true },
        { symbol: "VERYLONGSYMBOL", valid: false }, // too long
        { symbol: "test", valid: false }, // lowercase
        { symbol: "TE@ST", valid: false }, // invalid characters
      ];

      testCases.forEach(({ symbol, valid }) => {
        const result = validateTokenCreation({
          tokenName: "Test Token",
          symbol,
          totalSupply: "1000000",
          decimals: "8",
        });
        expect(result.isValid).toBe(valid);
      });
    });
  });

  describe("Transfer Validation", () => {
    test("should validate valid transfer", () => {
      const validData = {
        amount: "1000",
        recipient: "rrkah-fqaaa-aaaah-qcuea-cai",
      };

      const result = validateTransfer(validData);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("should reject invalid transfer", () => {
      const invalidData = {
        amount: "0", // zero amount
        recipient: "invalid-principal", // invalid format
      };

      const result = validateTransfer(invalidData);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("Token Operation Validation", () => {
    test("should validate valid operation", () => {
      const validData = {
        amount: "50000",
      };

      const result = validateTokenOperation(validData);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("should reject invalid operation", () => {
      const invalidData = {
        amount: "-1000", // negative amount
      };

      const result = validateTokenOperation(invalidData);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
