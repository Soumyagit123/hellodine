"""SQLAlchemy models — Core Tenancy: restaurants, branches, tables, table_qr_tokens"""
import uuid
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Restaurant(Base):
    __tablename__ = "restaurants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    gstin: Mapped[str | None] = mapped_column(Text, nullable=True)
    fssai_license_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    whatsapp_phone_number_id: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    whatsapp_display_number: Mapped[str] = mapped_column(Text, nullable=False)
    whatsapp_access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    whatsapp_verify_token: Mapped[str] = mapped_column(Text, default="hellodine", nullable=False)
    whatsapp_app_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    whatsapp_app_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    merchant_upi_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    subscription_plan: Mapped[str] = mapped_column(Text, default="STARTER", server_default="STARTER", nullable=False)
    subscription_status: Mapped[str] = mapped_column(Text, default="ACTIVE", server_default="ACTIVE", nullable=False)
    subscription_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pending_renewal_plan: Mapped[str | None] = mapped_column(Text, nullable=True)
    pending_renewal_utr: Mapped[str | None] = mapped_column(Text, nullable=True)
    pending_renewal_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_branches: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    branches: Mapped[list["Branch"]] = relationship("Branch", back_populates="restaurant")


class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    restaurant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    city: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(Text, nullable=False)
    pincode: Mapped[str] = mapped_column(Text, nullable=False)
    gstin: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    restaurant: Mapped["Restaurant"] = relationship("Restaurant", back_populates="branches")
    tables: Mapped[list["Table"]] = relationship("Table", back_populates="branch")


class Table(Base):
    __tablename__ = "tables"
    __table_args__ = (
        {"schema": None},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    table_number: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    branch: Mapped["Branch"] = relationship("Branch", back_populates="tables")
    qr_tokens: Mapped[list["TableQRToken"]] = relationship("TableQRToken", back_populates="table")


class TableQRToken(Base):
    __tablename__ = "table_qr_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    table_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tables.id"), nullable=False)
    token: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    table: Mapped["Table"] = relationship("Table", back_populates="qr_tokens")
