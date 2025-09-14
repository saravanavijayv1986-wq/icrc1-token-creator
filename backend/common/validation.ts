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

    // Enhanced IC principal validation with better error handling
    try {
      const principal = Principal.fromText(value);
      
      // Additional validation for common issues
      if (principal.isAnonymous()) {
        this.errors.push(`${fieldName} cannot be an anonymous principal`);
        return this;
      }

      // Validate principal text format more thoroughly
      if (!isValidPrincipalText(value)) {
        this.errors.push(`${fieldName} has invalid principal format`);
        return this;
      }

    } catch (error) {
      // More specific error messages based on the validation failure
      if (error instanceof Error) {
        if (error.message.includes('Invalid character')) {
          this.errors.push(`${fieldName} contains invalid characters - use only lowercase letters, numbers, and hyphens`);
        } else if (error.message.includes('Invalid length')) {
          this.errors.push(`${fieldName} has invalid length - must be between 5 and 63 characters`);
        } else if (error.message.includes('Invalid checksum')) {
          this.errors.push(`${fieldName} has invalid checksum - please verify the principal`);
        } else {
          this.errors.push(`${fieldName} is not a valid IC principal`);
        }
      } else {
        this.errors.push(`${fieldName} must be a valid IC principal`);
      }
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

// Enhanced principal validation helper
function isValidPrincipalText(principalText: string): boolean {
  if (!principalText || typeof principalText !== 'string') return false;
  
  // Length check
  if (principalText.length < 5 || principalText.length > 63) return false;
  
  // Character check - only lowercase letters, numbers, and hyphens
  if (!/^[a-z0-9-]+$/.test(principalText)) return false;
  
  // Must contain at least one hyphen (all valid principals have separators)
  if (!principalText.includes('-')) return false;
  
  // Check for valid principal patterns
  const patterns = [
    /^[a-z0-9]{2,}-[a-z0-9]{3}$/, // Short format like "2vxsx-fae"
    /^[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{3}$/, // Standard canister format
    /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/, // Variable length segments
  ];
  
  return patterns.some(pattern => pattern.test(principalText));
}

export function validate(): Validator {
  return new Validator();
}
