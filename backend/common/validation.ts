import { Principal } from "@dfinity/principal";

export interface ValidationRule<T> {
  validate: (value: T) => boolean;
  message: string;
}

export class Validator {
  private errors: string[] = [];

  required<T>(value: T, fieldName: string): this {
    if (value === null || value === undefined || value === '') {
      this.errors.push(`${fieldName} is required`);
    }
    return this;
  }

  string(value: any, fieldName: string, rules?: {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
  }): this {
    if (typeof value !== 'string') {
      this.errors.push(`${fieldName} must be a string`);
      return this;
    }

    if (rules?.minLength && value.length < rules.minLength) {
      this.errors.push(`${fieldName} must be at least ${rules.minLength} characters`);
    }

    if (rules?.maxLength && value.length > rules.maxLength) {
      this.errors.push(`${fieldName} must be at most ${rules.maxLength} characters`);
    }

    if (rules?.pattern && !rules.pattern.test(value)) {
      this.errors.push(`${fieldName} has invalid format`);
    }

    return this;
  }

  number(value: any, fieldName: string, rules?: {
    min?: number;
    max?: number;
    integer?: boolean;
  }): this {
    if (typeof value !== 'number' || isNaN(value)) {
      this.errors.push(`${fieldName} must be a valid number`);
      return this;
    }

    if (rules?.integer && !Number.isInteger(value)) {
      this.errors.push(`${fieldName} must be an integer`);
    }

    if (rules?.min !== undefined && value < rules.min) {
      this.errors.push(`${fieldName} must be at least ${rules.min}`);
    }

    if (rules?.max !== undefined && value > rules.max) {
      this.errors.push(`${fieldName} must be at most ${rules.max}`);
    }

    return this;
  }

  boolean(value: any, fieldName: string): this {
    if (typeof value !== 'boolean') {
      this.errors.push(`${fieldName} must be a boolean`);
    }
    return this;
  }

  principal(value: any, fieldName: string): this {
    if (typeof value !== 'string') {
      this.errors.push(`${fieldName} must be a string`);
      return this;
    }

    // Robust IC principal validation using @dfinity/principal
    try {
      Principal.fromText(value);
    } catch {
      this.errors.push(`${fieldName} must be a valid IC principal`);
    }

    return this;
  }

  custom<T>(value: T, rule: ValidationRule<T>): this {
    if (!rule.validate(value)) {
      this.errors.push(rule.message);
    }
    return this;
  }

  getErrors(): string[] {
    return this.errors;
  }

  isValid(): boolean {
    return this.errors.length === 0;
  }

  throwIfInvalid(): void {
    if (!this.isValid()) {
      throw new Error(`Validation failed: ${this.errors.join(', ')}`);
    }
  }
}

export function validate(): Validator {
  return new Validator();
}
