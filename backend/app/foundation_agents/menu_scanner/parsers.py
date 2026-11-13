"""Parsers for Excel, CSV, PDF, and Multimodal Images.

- Excel/CSV: 100% Zero-token local Python parser via openpyxl & csv module.
- Digital PDF: Local pypdf text extraction (zero model cost).
- Scanned PDF / Image: Gemini 2.5 Flash Vision Multimodal extractor.
"""
import io
import csv
import json
import re
from typing import Tuple, List, Dict, Any, Optional
import openpyxl
from pypdf import PdfReader
import google.generativeai as genai
from app.config import settings
from .schema import ExtractedMenuItem, ExtractedMenuCategory, MenuManifest, VariantItem

# Initialize Google AI for visual photo fallback
genai.configure(api_key=settings.GEMINI_API_KEY)


_HEADER_KEYWORDS = (
    "item", "dish", "name", "product", "price", "mrp", "rate", "cost",
    "amount", "category", "cat", "dietary", "veg", "gst", "tax", "description",
)


def _find_header_row_idx(rows: List[Any]) -> int:
    """Find the most likely header row index among the first 15 rows."""
    best_idx = -1
    best_score = 0
    for idx, row in enumerate(rows[:15]):
        if not row or not any(row):
            continue
        score = 0
        for cell in row:
            if cell is None:
                continue
            cell_str = str(cell).strip().lower()
            if any(kw in cell_str for kw in _HEADER_KEYWORDS):
                score += 1
        if score > best_score:
            best_score = score
            best_idx = idx
    if best_idx >= 0 and best_score >= 2:
        return best_idx
    # Fallback: first non-empty row
    for idx, row in enumerate(rows):
        if row and any(row):
            return idx
    return 0


def _rows_to_dicts(rows: List[Any]) -> List[Dict[str, Any]]:
    """Convert raw 2D rows into normalized dict rows starting from the detected header row."""
    if not rows:
        return []
    header_idx = _find_header_row_idx(rows)
    headers = [
        str(h).strip().lower().replace(" ", "_") if h is not None and str(h).strip() else f"col_{i}"
        for i, h in enumerate(rows[header_idx])
    ]
    data_rows = []
    for row in rows[header_idx + 1:]:
        if not row or not any(str(c).strip() for c in row if c is not None):
            continue
        row_dict = {}
        for h, val in zip(headers, row):
            row_dict[h] = str(val).strip() if val is not None else ""
        data_rows.append(row_dict)
    return data_rows


def parse_csv_bytes(file_bytes: bytes) -> List[Dict[str, Any]]:
    """Zero-cost local CSV parser with automatic header row detection and normalization."""
    text = file_bytes.decode("utf-8-sig", errors="ignore")
    rows = list(csv.reader(io.StringIO(text)))
    return _rows_to_dicts(rows)


def parse_excel_bytes(file_bytes: bytes) -> List[Dict[str, Any]]:
    """Zero-cost local Excel parser (.xlsx, .xls) using openpyxl."""
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    sheet = wb.active
    rows = list(sheet.iter_rows(values_only=True))
    return _rows_to_dicts(rows)


def parse_pdf_text_local(file_bytes: bytes) -> Tuple[str, bool]:
    """Zero-cost digital PDF extractor via pypdf. Returns (text, is_digital)."""
    reader = PdfReader(io.BytesIO(file_bytes))
    full_text = []
    for page in reader.pages:
        txt = page.extract_text()
        if txt:
            full_text.append(txt)
    combined = "\n".join(full_text).strip()
    # If the PDF has substantial extractable text (>= 50 chars), it is a digital PDF (zero model cost)
    is_digital = len(combined) >= 50
    return combined, is_digital


def _get_col_value(row: Dict[str, Any], exact_keys: Tuple[str, ...], substr_keys: Tuple[str, ...] = ()) -> str:
    """Find a column value by exact key first, then by substring match."""
    for k in exact_keys:
        if k in row and row[k]:
            return str(row[k]).strip()
    for rk, rv in row.items():
        if rv and any(sk in rk for sk in substr_keys):
            return str(rv).strip()
    return ""


def map_tabular_rows_to_items(rows: List[Dict[str, Any]]) -> List[ExtractedMenuItem]:
    """Maps arbitrary CSV or Excel columns to the canonical ExtractedMenuItem schema without LLM."""
    items: List[ExtractedMenuItem] = []

    for r in rows:
        # Find item name
        name = _get_col_value(
            r,
            ("item_name", "item", "dish", "dish_name", "name", "food_name", "title", "product"),
            ("item", "dish", "name", "product"),
        )
        if not name:
            # Try first string column
            for v in r.values():
                if len(str(v)) > 2 and not str(v).replace(".", "").isdigit():
                    name = str(v)
                    break
        if not name:
            continue

        # Find price
        price = 0.0
        raw_price = _get_col_value(
            r,
            ("price", "base_price", "rate", "cost", "mrp", "amount"),
            ("price", "mrp", "rate", "cost", "amount"),
        )
        if raw_price:
            try:
                num_str = re.sub(r"[^\d.]", "", raw_price)
                price = float(num_str) if num_str else 0.0
            except ValueError:
                pass

        # Find category
        category = _get_col_value(
            r,
            ("category", "cat", "group", "department", "menu_category", "section"),
            ("category", "group", "section"),
        )
        category = category.title() if category else "Main Course"

        # Sub category
        sub_category_raw = _get_col_value(
            r,
            ("sub_category", "subcategory", "sub_cat", "subgroup"),
            ("sub_cat", "subcategory"),
        )
        sub_category = sub_category_raw.title() if sub_category_raw else None

        # Veg or Non-Veg
        is_veg = True
        diet_val = _get_col_value(
            r,
            ("veg_nonveg", "veg", "type", "is_veg", "diet", "dietary_type"),
            ("veg", "diet", "type"),
        ).lower()
        if diet_val and any(nv in diet_val for nv in ("non", "chicken", "mutton", "fish", "egg", "prawn", "seafood", "meat", "red", "0")):
            is_veg = False

        # Description
        desc = None
        for k in ("description", "desc", "details", "info", "ingredients"):
            if k in r and r[k]:
                desc = r[k]
                break

        # GST percent
        gst = 5
        for k in ("gst", "gst_percent", "tax", "tax_percent"):
            if k in r and r[k]:
                try:
                    parsed_gst = int(float(re.sub(r"[^\d.]", "", str(r[k]))))
                    if parsed_gst in (0, 5, 12, 18):
                        gst = parsed_gst
                except ValueError:
                    pass

        # Bestseller flag
        bestseller = False
        for k in ("bestseller", "is_bestseller", "star", "popular", "special"):
            if k in r and r[k]:
                bestseller = str(r[k]).lower() in ("yes", "true", "1", "star", "special")
                break

        items.append(ExtractedMenuItem(
            name=name,
            category=category,
            sub_category=sub_category,
            base_price=price,
            description=desc,
            is_veg=is_veg,
            gst_percent=gst,
            is_bestseller=bestseller,
        ))

    return items


async def parse_unstructured_text_with_llm(raw_text: str) -> List[ExtractedMenuItem]:
    """Uses Gemini 2.5 Flash Lite with compact zero-shot instructions to convert raw PDF text to JSON."""
    model = genai.GenerativeModel(
        "gemini-2.5-flash-lite",
        generation_config={
            "temperature": 0.0,
            "max_output_tokens": 4096,
            "response_mime_type": "application/json",
        },
    )
    prompt = f"""You are an expert Restaurant Menu Parser.
Extract all menu items from this raw text into a strict JSON list of objects:
[
  {{
    "name": "Dish Name",
    "category": "Category name (e.g. Starters, Main Course, Tandoor, Breads, Desserts)",
    "sub_category": null,
    "base_price": 250.0,
    "description": "Short description if available",
    "is_veg": true,
    "gst_percent": 5,
    "is_bestseller": false,
    "variants": []
  }}
]

Rules:
1. Infer is_veg=false if item has chicken, mutton, egg, fish, prawn, meat, pork, beef.
2. If price is missing or unreadable, set base_price: 0.0.
3. Return ONLY valid JSON array.

Menu Text:
{raw_text[:12000]}
"""
    response = await model.generate_content_async(prompt)
    txt = response.text.strip()
    match = re.search(r"\[.*\]", txt, re.DOTALL)
    if not match:
        return []
    data = json.loads(match.group(0))
    return [ExtractedMenuItem(**item) for item in data]


async def parse_image_with_multimodal_vision(file_bytes: bytes, mime_type: str = "image/jpeg") -> List[ExtractedMenuItem]:
    """Uses Gemini 2.5 Flash Vision to parse handheld photos or scanned menu cards."""
    model = genai.GenerativeModel(
        "gemini-2.5-flash",
        generation_config={
            "temperature": 0.0,
            "max_output_tokens": 6144,
            "response_mime_type": "application/json",
        },
    )
    prompt = """You are an expert Restaurant Menu Digitizer.
Carefully examine this menu card image / scan.
Extract all dishes and beverages into a strict JSON list of objects:
[
  {
    "name": "Dish Name",
    "category": "Category name (e.g. Starters, Soups, Biryani, Main Course, Chinese, Desserts)",
    "sub_category": "Veg or Non-Veg if grouped by section",
    "base_price": 240.0,
    "description": "Ingredients or preparation note if printed",
    "is_veg": true,
    "gst_percent": 5,
    "is_bestseller": false,
    "variants": []
  }
]

Extraction rules:
1. Preserve exact dish names printed on the card.
2. Read the price accurately. If a dish has multiple prices (e.g. Half 150 / Full 280), set base_price to Full and add to "variants": [{"name": "Half", "price": 150}, {"name": "Full", "price": 280}].
3. If price is not printed or smudged, set base_price: 0.0.
4. Correctly classify is_veg based on green/red dots or category titles.
5. Return ONLY a valid JSON array.
"""
    image_part = {"mime_type": mime_type, "data": file_bytes}
    response = await model.generate_content_async([prompt, image_part])
    txt = response.text.strip()
    match = re.search(r"\[.*\]", txt, re.DOTALL)
    if not match:
        return []
    data = json.loads(match.group(0))
    return [ExtractedMenuItem(**item) for item in data]
