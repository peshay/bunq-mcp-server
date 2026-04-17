export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "CONFIG_ERROR", details);
    this.name = "ConfigError";
  }
}

export class ExternalApiError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "EXTERNAL_API_ERROR", details);
    this.name = "ExternalApiError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export class FeatureDisabledError extends AppError {
  constructor(feature: string) {
    super(`${feature} is disabled by configuration`, "FEATURE_DISABLED", { feature });
    this.name = "FeatureDisabledError";
  }
}
