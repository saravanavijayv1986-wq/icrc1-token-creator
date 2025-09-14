import { expect, test, describe } from "vitest";
import { validate, Validator } from "./validation";

describe("Validation", () => {
  describe("Basic Validation", () => {
    test("should validate required fields", () => {
      const validator = validate()
        .required("test", "field")
        .required(null, "nullField")
        .required("", "emptyField");

      const errors = validator.getErrors();
      expect(errors).toHaveLength(2);
      expect(errors).toContain("nullField is required");
      expect(errors).toContain("emptyField is required");
    });

    test("should validate string fields", () => {
      const validator = validate()
        .string("test", "validString")
        .string(123, "invalidString")
        .string("a", "shortString", { minLength: 3 })
        .string("verylongstring", "longString", { maxLength: 5 })
        .string("invalid@", "patternString", { pattern: /^[a-zA-Z]+$/ });

      const errors = validator.getErrors();
      expect(errors).toHaveLength(4);
      expect(errors.some(e => e.includes("invalidString"))).toBe(true);
      expect(errors.some(e => e.includes("shortString"))).toBe(true);
      expect(errors.some(e => e.includes("longString"))).toBe(true);
      expect(errors.some(e => e.includes("patternString"))).toBe(true);
    });

    test("should validate number fields", () => {
      const validator = validate()
        .number(42, "validNumber")
        .number("not a number", "invalidNumber")
        .number(5, "smallNumber", { min: 10 })
        .number(15, "largeNumber", { max: 10 })
        .number(3.14, "decimalNumber", { integer: true });

      const errors = validator.getErrors();
      expect(errors).toHaveLength(4);
      expect(errors.some(e => e.includes("invalidNumber"))).toBe(true);
      expect(errors.some(e => e.includes("smallNumber"))).toBe(true);
      expect(errors.some(e => e.includes("largeNumber"))).toBe(true);
      expect(errors.some(e => e.includes("decimalNumber"))).toBe(true);
    });

    test("should validate boolean fields", () => {
      const validator = validate()
        .boolean(true, "validBoolean")
        .boolean("not boolean", "invalidBoolean");

      const errors = validator.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors).toContain("invalidBoolean must be a boolean");
    });

    test("should validate IC principals", () => {
      const validator = validate()
        .principal("rrkah-fqaaa-aaaah-qcuea-cai", "validPrincipal")
        .principal("invalid-principal", "invalidPrincipal")
        .principal(123, "nonStringPrincipal");

      const errors = validator.getErrors();
      expect(errors).toHaveLength(2);
      expect(errors.some(e => e.includes("invalidPrincipal"))).toBe(true);
      expect(errors.some(e => e.includes("nonStringPrincipal"))).toBe(true);
    });

    test("should validate custom rules", () => {
      const customRule = {
        validate: (value: number) => value % 2 === 0,
        message: "Must be even number"
      };

      const validator = validate()
        .custom(4, customRule)
        .custom(3, customRule);

      const errors = validator.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors).toContain("Must be even number");
    });
  });

  describe("Validator State", () => {
    test("should track validity correctly", () => {
      const validValidator = validate()
        .required("test", "field")
        .string("test", "field");

      expect(validValidator.isValid()).toBe(true);

      const invalidValidator = validate()
        .required("", "emptyField");

      expect(invalidValidator.isValid()).toBe(false);
    });

    test("should throw when invalid if requested", () => {
      const validator = validate()
        .required("", "requiredField");

      expect(() => validator.throwIfInvalid()).toThrow();
    });

    test("should not throw when valid", () => {
      const validator = validate()
        .required("test", "field");

      expect(() => validator.throwIfInvalid()).not.toThrow();
    });
  });

  describe("Edge Cases", () => {
    test("should handle undefined and null values", () => {
      const validator = validate()
        .string(undefined, "undefinedField")
        .string(null, "nullField")
        .number(undefined, "undefinedNumber")
        .number(null, "nullNumber");

      const errors = validator.getErrors();
      expect(errors).toHaveLength(4);
    });

    test("should handle empty validation", () => {
      const validator = validate();
      expect(validator.isValid()).toBe(true);
      expect(validator.getErrors()).toHaveLength(0);
    });

    test("should handle zero values correctly", () => {
      const validator = validate()
        .required(0, "zeroField") // 0 should be valid for required
        .number(0, "zeroNumber", { min: 1 }); // but fail min validation

      const errors = validator.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("zeroNumber must be at least 1");
    });

    test("should handle false boolean correctly", () => {
      const validator = validate()
        .required(false, "falseField") // false should be valid for required
        .boolean(false, "falseBoolean");

      expect(validator.isValid()).toBe(true);
    });
  });

  describe("IC Principal Validation", () => {
    test("should accept valid principal formats", () => {
      const validPrincipals = [
        "rrkah-fqaaa-aaaah-qcuea-cai",
        "rdmx6-jaaaa-aaaah-qca7q-cai",
        "2vxsx-fae",
      ];

      validPrincipals.forEach(principal => {
        const validator = validate().principal(principal, "testPrincipal");
        expect(validator.isValid()).toBe(true);
      });
    });

    test("should reject invalid principal formats", () => {
      const invalidPrincipals = [
        "invalid-principal",
        "too-short",
        "UPPERCASE-NOT-ALLOWED",
        "has@special#chars",
        "",
        "rrkah-fqaaa-aaaah-qcuea-cai-toolong",
      ];

      invalidPrincipals.forEach(principal => {
        const validator = validate().principal(principal, "testPrincipal");
        expect(validator.isValid()).toBe(false);
      });
    });
  });
});
