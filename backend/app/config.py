from pydantic_settings import BaseSettings, SettingsConfigDict


import os

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(__file__), "../../.env"), 
        extra="ignore"
    )

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://hellodine:hellodine_pass@localhost:5432/hellodine"
    REDIS_URL: str = "redis://localhost:6379/0"

    # Security
    SECRET_KEY: str = "change_me"
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



settings = Settings()
