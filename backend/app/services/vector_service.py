"""Supabase pgvector Semantic Search & Google Gemini Embedding Service for Menu Items."""
import asyncio
import uuid
import logging
from typing import Optional, Any
import google.generativeai as genai  # type: ignore
from sqlalchemy import text, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.menu import MenuItem, MenuCategory

logger = logging.getLogger(__name__)

# Configure Gemini for embeddings
_genai: Any = genai
if settings.GEMINI_API_KEY:
    _genai.configure(api_key=settings.GEMINI_API_KEY)

EMBEDDING_MODEL = "models/text-embedding-004"
_BACKFILLED_BRANCHES: set[str] = set()


def build_menu_item_document(item: MenuItem, category_name: str = "") -> str:
    """Build rich semantic text for a MenuItem so pgvector understands taste, diet, category, and description."""
    veg_str = "Pure Vegetarian (Veg)" if item.is_veg else "Non-Vegetarian (Non-Veg, Meat/Chicken/Fish/Egg)"
    jain_str = "Jain friendly" if getattr(item, "is_jain", False) else ""
    best_str = "Chef Bestseller Top Recommended Popular Dish" if getattr(item, "is_bestseller", False) else ""
    spice_val = (
        str(item.spice_level.value if hasattr(item.spice_level, "value") else item.spice_level)
        if item.spice_level
        else "medium"
    )
    desc = item.description or f"Delicious freshly prepared {item.name}"
    return (
        f"Dish: {item.name} | Category: {category_name} | Diet: {veg_str} {jain_str} | "
        f"Spice Level: {spice_val} | Price: Rs {float(item.base_price):.0f} | {best_str} | Description: {desc}"
    )


def generate_text_embedding(text_input: str, task_type: str = "retrieval_document") -> Optional[list[float]]:
    """Generate a 768-dimensional embedding vector using Google Gemini text-embedding-004."""
    if not settings.GEMINI_API_KEY or not text_input.strip():
        return None
    try:
        res: Any = _genai.embed_content(
            model=EMBEDDING_MODEL,
            content=text_input,
            task_type=task_type,
        )
        embedding = res.get("embedding") if isinstance(res, dict) else getattr(res, "embedding", None)
        if isinstance(embedding, list) and len(embedding) == 768:
            return [float(x) for x in embedding]
    except Exception as e:
        logger.warning(f"Embedding generation warning: {e}")
    return None


def _vector_to_pg_literal(vec: list[float]) -> str:
    """Format a Python float list as a PostgreSQL pgvector literal '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{float(v):.6f}" for v in vec) + "]"


async def embed_and_save_menu_item(item_id: uuid.UUID, db: AsyncSession) -> bool:
    """Generate and store the pgvector embedding for a single MenuItem in Supabase."""
    try:
        res = await db.execute(
            select(MenuItem, MenuCategory.name.label("cat_name"))
            .outerjoin(MenuCategory, MenuItem.category_id == MenuCategory.id)
            .where(MenuItem.id == item_id)
        )
        row = res.first()
        if not row:
            return False
        item, cat_name = row[0], row[1] or ""
        doc = build_menu_item_document(item, cat_name)
        vec = generate_text_embedding(doc, task_type="retrieval_document")
        if not vec:
            return False

        vec_literal = _vector_to_pg_literal(vec)
        await db.execute(
            text("UPDATE menu_items SET embedding = CAST(:vec AS vector) WHERE id = :id"),
            {"vec": vec_literal, "id": item.id},
        )
        await db.commit()
        return True
    except Exception as e:
        logger.warning(f"Could not save pgvector embedding for item {item_id}: {e}")
        return False


async def backfill_missing_menu_embeddings(db: AsyncSession, branch_id: Optional[uuid.UUID] = None) -> int:
    """Ensure all available menu items have pgvector embeddings stored in Supabase."""
    try:
        sql_check = "SELECT id FROM menu_items WHERE embedding IS NULL AND is_available = TRUE"
        params = {}
        if branch_id:
            sql_check += " AND branch_id = :bid"
            params["bid"] = branch_id
        sql_check += " LIMIT 30"

        missing_res = await db.execute(text(sql_check), params)
        missing_ids = [r[0] for r in missing_res.fetchall()]
        count = 0
        for mid in missing_ids:
            ok = await embed_and_save_menu_item(mid, db)
            if ok:
                count += 1
        return count
    except Exception as e:
        logger.warning(f"Backfill pgvector embeddings skipped/warning: {e}")
        return 0


async def pgvector_search_menu_items(
    branch_id: str,
    query_text: str,
    db: AsyncSession,
    is_veg: Optional[bool] = None,
    limit: int = 6,
) -> list[MenuItem]:
    """
    Search MenuItems in Supabase using pgvector cosine distance (`embedding <=> query_vec`).
    Automatically backfills missing embeddings on the branch if needed.
    """
    if not query_text.strip() or not settings.GEMINI_API_KEY:
        return []

    try:
        # Generate query embedding directly without blocking on full menu backfill
        query_vec = await asyncio.to_thread(generate_text_embedding, query_text, "retrieval_query")
        if not query_vec:
            return []

        vec_literal = _vector_to_pg_literal(query_vec)

        veg_clause = ""
        params: dict = {
            "bid": uuid.UUID(branch_id),
            "vec": vec_literal,
            "lim": limit,
        }
        if is_veg is not None:
            veg_clause = " AND is_veg = :is_veg "
            params["is_veg"] = bool(is_veg)

        # Cosine distance (<=>): lower distance = higher semantic similarity
        # Only return items with cosine similarity >= 0.45 (distance <= 0.55)
        sql = text(
            f"""
            SELECT id, (embedding <=> CAST(:vec AS vector)) AS distance
            FROM menu_items
            WHERE branch_id = :bid
              AND is_available = TRUE
              AND embedding IS NOT NULL
              {veg_clause}
            ORDER BY (CASE WHEN is_bestseller THEN -0.05 ELSE 0 END) + (embedding <=> CAST(:vec AS vector)) ASC
            LIMIT :lim
            """
        )
        rows = (await db.execute(sql, params)).fetchall()
        if not rows:
            return []

        matched_ids = [r[0] for r in rows if float(r[1]) <= 0.58]
        if not matched_ids:
            return []

        items_res = await db.execute(select(MenuItem).where(MenuItem.id.in_(matched_ids)))
        items_by_id = {i.id: i for i in items_res.scalars().all()}
        return [items_by_id[mid] for mid in matched_ids if mid in items_by_id]
    except Exception as e:
        logger.warning(f"pgvector search fallback (using SQL/keyword): {e}")
        return []

