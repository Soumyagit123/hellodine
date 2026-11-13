"""Canonical Schema models for Menu Ingestion Foundation Agent.

This schema is database-agnostic. Any document (Image, PDF, Excel, CSV)
is first parsed and normalized into this standard canonical format.
"""
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class VariantItem(BaseModel):
    name: str = Field(..., description="Variant name, e.g. 'Half', 'Full', 'Regular', 'Large'")
    price: float = Field(..., description="Variant price in local currency")


class ExtractedMenuItem(BaseModel):
    name: str = Field(..., description="Name of the food or beverage item")
    category: str = Field(default="Main Course", description="Category or department, e.g. 'Starters', 'Desserts'")
    sub_category: Optional[str] = Field(default=None, description="Optional sub-category, e.g. 'Veg Starters'")
    base_price: float = Field(default=0.0, description="Base selling price of the item")
    description: Optional[str] = Field(default=None, description="Description, ingredients, or preparation style")
    is_veg: bool = Field(default=True, description="Whether the item is vegetarian (True) or non-vegetarian (False)")
    gst_percent: int = Field(default=5, description="GST tax rate slab (0, 5, 12, 18)")
    is_bestseller: bool = Field(default=False, description="Whether the item is marked as a chef special / bestseller")
    image_url: Optional[str] = Field(default=None, description="Optional image URL or reference")
    variants: List[VariantItem] = Field(default_factory=list, description="Optional size or portion variants")

    # HITL Validation Metadata
    needs_review: bool = Field(default=False, description="Flagged for human-in-the-loop review")
    review_reasons: List[str] = Field(default_factory=list, description="Reasons requiring human verification")


class ExtractedMenuCategory(BaseModel):
    name: str
    items: List[ExtractedMenuItem] = Field(default_factory=list)


class MenuManifest(BaseModel):
    total_categories: int = 0
    total_items: int = 0
    items_ready: int = 0
    items_needing_review: int = 0
    categories: List[ExtractedMenuCategory] = Field(default_factory=list)
    raw_preview_text: Optional[str] = None
