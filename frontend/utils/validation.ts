import { Principal } from "@dfinity/principal";

export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  custom?: (value: any) => boolean;
  message?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class FormValidator {
  private errors: string[] = [];

  validateField(
    fieldName: string,
    value: any,
    rules: ValidationRule
  ): this {
    if (rules.required && (value === null || value === undefined || value === '')) {
      this.errors.push(`${fieldName} is required`);
      return this;
    }

    if (value === null || value === undefined || value === '') {
      return this; // Skip other validations if not required and empty
    }

    if (rules.minLength && String(value).length < rules.minLength) {
      this.errors.push(`${fieldName} must be at least ${rules.minLength} characters`);
    }

    if (rules.maxLength && String(value).length > rules.maxLength) {
      this.errors.push(`${fieldName} must be at most ${rules.maxLength} characters`);
    }

    if (rules.min !== undefined && Number(value) < rules.min) {
      this.errors.push(`${fieldName} must be at least ${rules.min}`);
    }

    if (rules.max !== undefined && Number(value) > rules.max) {
      this.errors.push(`${fieldName} must be at most ${rules.max}`);
    }

    if (rules.pattern && !rules.pattern.test(String(value))) {
      this.errors.push(rules.message || `${fieldName} has invalid format`);
    }

    if (rules.custom && !rules.custom(value)) {
      this.errors.push(rules.message || `${fieldName} is invalid`);
    }

    return this;
  }

  getResult(): ValidationResult {
    return {
      isValid: this.errors.length === 0,
      errors: [...this.errors]
    };
  }

  reset(): this {
    this.errors = [];
    return this;
  }
}

// Pre-defined validation rules
export const validationRules = {
  tokenName: {
    required: true,
    minLength: 2,
    maxLength: 50,
    pattern: /^[a-zA-Z0-9\s\-_]+$/,
    message: "Token name must contain only letters, numbers, spaces, hyphens, and underscores"
  },
  
  tokenSymbol: {
    required: true,
    minLength: 2,
    maxLength: 10,
    pattern: /^[A-Z0-9]+$/,
    message: "Symbol must contain only uppercase letters and numbers"
  },
  
  totalSupply: {
    required: true,
    min: 1,
    max: 1000000000000,
    custom: (value: any) => Number.isInteger(Number(value)) && Number(value) > 0,
    message: "Total supply must be a positive integer"
  },
  
  decimals: {
    required: true,
    min: 0,
    max: 18,
    custom: (value: any) => Number.isInteger(Number(value)),
    message: "Decimals must be an integer between 0 and 18"
  },
  
  principal: {
    required: true,
    custom: (value: any) => {
      if (typeof value !== 'string' || value.length === 0) return false;
      try {
        Principal.fromText(value);
        return true;
      } catch {
        return false;
      }
    },
    message: "Invalid principal format"
  },
  
  amount: {
    required: true,
    min: 1,
    custom: (value: any) => Number.isInteger(Number(value)) && Number(value) > 0,
    message: "Amount must be a positive integer"
  }
};

export function validateTokenCreation(data: {
  tokenName: string;
  symbol: string;
  totalSupply: string;
  decimals: string;
}): ValidationResult {
  const validator = new FormValidator();
  
  validator
    .validateField('Token Name', data.tokenName, validationRules.tokenName)
    .validateField('Symbol', data.symbol, validationRules.tokenSymbol)
    .validateField('Total Supply', data.totalSupply, validationRules.totalSupply)
    .validateField('Decimals', data.decimals, validationRules.decimals);
  
  return validator.getResult();
}

export function validateTransfer(data: {
  amount: string;
  recipient: string;
}): ValidationResult {
  const validator = new FormValidator();
  
  validator
    .validateField('Amount', data.amount, validationRules.amount)
    .validateField('Recipient', data.recipient, validationRules.principal);
  
  return validator.getResult();
}

export function validateTokenOperation(data: {
  amount: string;
}): ValidationResult {
  const validator = new FormValidator();
  
  validator.validateField('Amount', data.amount, validationRules.amount);
  
  return validator.getResult();
}
