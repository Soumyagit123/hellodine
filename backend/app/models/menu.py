"""SQLAlchemy models — Menu (India-Ready)"""
import uuid
from datetime import datetime
import enum
from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, Enum, ForeignKey,
    Integer, Numeric, Text, ARRAY, String, func
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class SpiceLevel(str, enum.Enum):
    mild = "mild"
    medium = "medium"
    hot = "hot"


class MenuCategory(Base):
    __tablename__ = "menu_categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    estimated_prep_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    items: Mapped[list["MenuItem"]] = relationship("MenuItem", back_populates="category")


class MenuItem(Base):
    __tablename__ = "menu_items"
    __table_args__ = (
        CheckConstraint("gst_percent IN (0, 5, 12, 18)", name="ck_gst_slabs"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    category_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("menu_categories.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    gst_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    hsn_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_veg: Mapped[bool] = mapped_column(Boolean, default=True)
    is_jain: Mapped[bool] = mapped_column(Boolean, default=False)
    spice_level: Mapped[SpiceLevel | None] = mapped_column(Enum(SpiceLevel), nullable=True)
    allergens: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)
    calories: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_bestseller: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    category: Mapped["MenuCategory"] = relationship("MenuCategory", back_populates="items")
    variants: Mapped[list["MenuItemVariant"]] = relationship("MenuItemVariant", back_populates="item")
    modifier_groups: Mapped[list["MenuModifierGroup"]] = relationship("MenuModifierGroup", back_populates="item")


class MenuItemVariant(Base):
    __tablename__ = "menu_item_variants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    menu_item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("menu_items.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)

    item: Mapped["MenuItem"] = relationship("MenuItem", back_populates="variants")


class MenuModifierGroup(Base):
    __tablename__ = "menu_modifier_groups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    menu_item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("menu_items.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    min_select: Mapped[int] = mapped_column(Integer, default=0)
    max_select: Mapped[int] = mapped_column(Integer, default=1)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)

    item: Mapped["MenuItem"] = relationship("MenuItem", back_populates="modifier_groups")
    modifiers: Mapped[list["MenuModifier"]] = relationship("MenuModifier", back_populates="group")


class MenuModifier(Base):
    __tablename__ = "menu_modifiers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    modifier_group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("menu_modifier_groups.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    price_delta: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)

    group: Mapped["MenuModifierGroup"] = relationship("MenuModifierGroup", back_populates="modifiers")
