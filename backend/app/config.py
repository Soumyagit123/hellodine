from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator
import os
import secrets

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(__file__), "../../.env"), 
        extra="ignore"
    )

    ENVIRONMENT: str = "development"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://hellodine:hellodine_pass@localhost:5432/hellodine"
    REDIS_URL: str = "redis://localhost:6379/0"

    # Security
    SECRET_KEY: str = ""
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    ALGORITHM: str = "HS256"

    # WhatsApp
    WA_PHONE_NUMBER_ID: str = ""
    WA_ACCESS_TOKEN: str = ""
    WA_WEBHOOK_VERIFY_TOKEN: str = "hellodine_verify_token_123"
    WA_APP_ID: str = ""
    WA_APP_SECRET: str = ""
    WA_API_URL: str = "https://graph.facebook.com/v22.0"

    # Gemini
    GEMINI_API_KEY: str = ""

    # Merchant UPI ID for Table QR Payments (Fallback if restaurant hasn't set its own)
    MERCHANT_UPI_ID: str = "hellodine@ybl"
    # SaaS Platform Owner UPI ID (For restaurants paying subscription fees to you)
    SAAS_OWNER_UPI_ID: str = "hellodine.saas@ybl"
    SAAS_OWNER_NAME: str = "HelloDine SaaS Platform"

    @model_validator(mode="after")
    def validate_secrets(self):
        is_prod = self.ENVIRONMENT.lower() in ("production", "prod")
        insecure_keys = {"change_me", "secret", "123456", "admin", "password"}

        if not self.SECRET_KEY or self.SECRET_KEY in insecure_keys:
            if is_prod:
                raise ValueError("CRITICAL SECURITY ERROR: SECRET_KEY must be set to a secure, random string in production.")
            # Auto-generate temporary development key if unset
            self.SECRET_KEY = secrets.token_urlsafe(32)

        if is_prod and len(self.SECRET_KEY) < 32:
            raise ValueError("CRITICAL SECURITY ERROR: SECRET_KEY must be at least 32 characters in production.")

        return self

settings = Settings()
