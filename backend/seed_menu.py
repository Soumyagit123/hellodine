import asyncio
import uuid
import re
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select, delete
from app.config import settings
from app.models.menu import MenuCategory, MenuItem, MenuItemVariant, SpiceLevel

# Target branch
BRANCH_ID = uuid.UUID("70d0ca23-a03a-4d7b-a262-f075593cdde7")

MENU_DATA = {
    "NON VEG STARTER": [
        ("PEPPER CHICKEN", "140"),
        ("CHICKEN 65", "150"),
        ("CHICKEN LOLLIPOP (2PIC)", "80"),
        ("CHICKEN LOLLIPOP (4PIC)", "150"),
        ("CHICKEN DRUM STICK (2PIC)", "80"),
        ("CHICKEN DRUM STICK (4PIC)", "140"),
        ("CHICKEN MANCHURIAN", "150"),
        ("CHILLI CHICKEN (6 PIC)", "120"),
        ("CHILLI CHICKEN (10PIC)", "150"),
        ("CHILLI CHICKEN BL (6PIC)", "160"),
        ("CHILLI CHICKEN BL (10PIC)", "200"),
        ("GARLIC CHICKEN", "150"),
        ("CHICKEN PAKODA (6PIC)", "100"),
        ("CHICKEN PAKODA (8PIC)", "120"),
        ("CHICKEN 555BL", "200"),
        ("BALI PRAWN", "200"),
        ("CHILLI PRAWN", "180"),
        ("GARLIC PRAWN", "180"),
        ("CHILLI EGG", "80"),
        ("EGG MANCHURIAN", "80"),
        ("CHICKEN MAJESTIC", "200"),
        ("HONG KONG CHICKEN BL", "200"),
        ("CHICKEN CRISPY FRY", "220"),
        ("CHILLI WINGS", "140"),
        ("GINGER CHICKEN", "150"),
        ("LEMON CHICKEN", "150"),
        ("DRAGON CHICKEN", "200"),
        ("APPOLLO FISH FRY", "180"),
        ("CHILLY FISH", "200"),
        ("FISH FINGER", "200"),
        ("FISH 65", "200"),
        ("FISH MANCHURIAN", "200"),
    ],
    "EGG": [
        ("EGG TADKA", "70/100"),
        ("EGG OMLETE", "40"),
        ("EGG BHURJI", "50"),
        ("EGG CURRY", "60"),
        ("EGG MASALA", "80"),
        ("EGG DO PYAZA", "100"),
        ("EGG BHURJI MASALA", "70/100"),
        ("BOILED EGG", "25"),
    ],
    "ROTI": [
        ("TAWA ROTI", "7"),
        ("TANDOORI ROTI", "15"),
        ("PLAIN NAAN", "20"),
        ("BUTTER NAAN", "25"),
        ("MASALA KULCHA", "50"),
        ("RAJASTHANI NAAN", "50"),
        ("CHICKEN KIMA NAAN", "70"),
        ("ALOO PARATHA", "30"),
        ("PANEER PARATHA", "50"),
        ("LACHA PARATHA", "20"),
        ("PLAIN PARATHA", "15"),
        ("MUGHLAI PARATHA", "70"),
    ],
    "FISH": [
        ("FISH MASALA", "120"),
        ("FISH FRY", "100"),
        ("FISH DO PYAZA", "120"),
        ("FISH KADHAI", "120"),
    ],
    "NON VEG MAIN": [
        ("CHICKEN MASALA", "160/200"),
        ("KAJU CHICKEN CURRY", "170/220"),
        ("CHICKEN KASA", "130/180"),
        ("CHICKEN DO PYAZA", "130/180"),
        ("CHICKEN CURRY", "120/180"),
        ("CHICKEN BUTTER MASALA", "160/220"),
        ("CHICKEN SHAHI KORMA", "180/240"),
        ("CHICKEN MUGHLAI", "200/250"),
        ("CHICKEN AFGHANI", "200/250"),
        ("LUCKY SPECIAL CHICKEN", "250"),
        ("CHICKEN BHARTA", "150"),
        ("METHI CHICKEN", "130/180"),
        ("DUM KA CHICKEN", "130/180"),
        ("CHICKEN HYDRABADI", "160/220"),
        ("PUNJABI CHICKEN", "180/240"),
        ("CHICKEN TIKKA MASALA", "160/220"),
        ("ANDHRA CHICKEN", "160/220"),
        ("CHICKEN BUNNA MASALA", "200/250"),
        ("CHICKEN TIKKA LABABDAR", "160/200"),
        ("TANDOORI CHICKEN LABABDAR", "200"),
        ("CHICKEN KASHMIR CURRY", "180"),
        ("CHICKEN KIMA MASALA", "170"),
    ],
    "INDIAN VEG CURRY": [
        ("MIX VEG CURRY", "80/120"),
        ("ALOO GOBI MUTTER", "80/120"),
        ("MALAI KOFTA", "120"),
        ("KASHMIRI KOFTA", "140"),
        ("MUSHROOM BUTTER MASALA", "120/160"),
        ("MUSHROOM CURRY/BESSAR", "120/160"),
        ("MUSHROOM MASALA", "120/160"),
        ("KADHAI MUSHROOM", "140/220"),
        ("MUSHROOM DO PYAZA", "140/220"),
        ("PANEER BUTTER MASALA", "140/200"),
        ("PANEER MASALA", "100/150"),
        ("KADHAI PANEER", "140/220"),
        ("PANEER DO PYAZA", "140/220"),
        ("PANEER HYDRABADI", "120/180"),
        ("SAHI PANEER", "150"),
        ("PANEER LABABDAR", "120/180"),
        ("PANEER KOFTA", "160"),
        ("PANEER BHURJI MASALA", "120/180"),
        ("PANEER BHARTA", "120/180"),
        ("GREEN PEAS MASALA", "80/120"),
        ("VEG HYDERABADI", "80/140"),
        ("CHANA MASALA", "90/120"),
        ("NAVRATANA KURMA", "120/180"),
        ("MIX VEG BHAJA", "70"),
        ("BAIGAN BHARTA", "70"),
        ("BADI CHURA", "50"),
        ("TOMATO CHUTNEY", "50"),
        ("BOONDI RAITA", "40"),
        ("GREEN SALAD", "70"),
        ("PAPAD", "15"),
        ("MASALA PAPAD", "25"),
    ],
    "THALI": [
        ("VEG THALI", "70"),
        ("DELUX VEG", "90"),
        ("SPECIAL VEG", "120"),
        ("FISH THALI", "80"),
        ("EGG THALI", "80"),
        ("CHICKEN THALI", "110"),
    ],
    "VEG STARTER": [
        ("CHILLI GOBI", "120"),
        ("GOBI 65", "120"),
        ("GOBI PAKODA", "80"),
        ("ONION PAKODA", "70"),
        ("VEG PAKODA", "90"),
        ("PANEER PAKODA", "130"),
        ("GOBI/VEG MANCHURIAN", "130"),
        ("CHILLI MUSHROOM", "140"),
        ("FRENCH FRIES", "80"),
        ("CRISPY CORN", "100"),
        ("CHILLI BABY CORN", "120"),
        ("BABY CORN 65", "120"),
        ("BABY CORN MANCHURIAN", "120"),
        ("BABY CORN 555", "150"),
        ("PANEER PASINDA", "180"),
        ("CRISPY PANEER", "150"),
        ("CHILLI PANEER", "150"),
    ],
    "TANDOOR": [
        ("TANDOORI CHICKEN (FULL)", "400"),
        ("TANDOORI CHICKEN (HALF)", "250"),
        ("CHICKEN TIKKA (8PIC)", "170"),
        ("TANGDI KEBAB (2PIC)", "140"),
        ("TANGDI KEBAB (4PIC)", "250"),
        ("KALMI KEBAB (2PIC)", "140"),
        ("KALMI KEBAB (4PIC)", "250"),
        ("LEMON CORIANDER", "170"),
        ("PANEER TIKKA", "170"),
        ("HARIYALI TIKKA (8 PIC)", "170"),
        ("RESHMI KEBAB (8PIC)", "170"),
        ("MALAI TIKKA (8PIC)", "170"),
    ],
    "RICE": [
        ("PLAIN RICE", "25"),
        ("LEMON RICE", "90"),
        ("JEERA RICE", "90"),
        ("VEG PULAO", "120"),
        ("KASHMIRI PULAO", "150"),
        ("PANEER PULAO", "150"),
    ],
    "FRIED RICE": [
        ("VEG FRIED RICE", "90"),
        ("CHICKEN FRIED RICE", "130"),
        ("EGG FRIED RICE", "100"),
        ("SCHEZWAN FRIED RICE", "120"),
        ("MIX VEG FRIED RICE", "120"),
        ("SCHEZWAN FRIED RICE NON VEG", "140"),
        ("MIX NON VEG FRIED RICE", "170"),
        ("MUSHROOM FRIED RICE", "100"),
        ("PANEER FRIED RICE", "100"),
    ],
    "PRAWN": [
        ("PRAWN CURRY", "180/240"),
        ("PRAWN MASALA", "180/240"),
        ("PRAWN DOPIAZA", "180/240"),
        ("KADHAI PRAWN", "180/240"),
        ("PRAWN FRY", "180/240"),
    ],
    "SOUP": [
        ("VEG MANCHOW SOUP", "100"),
        ("VEG SWEET CORN SOUP", "100"),
        ("VEG HOT AND SOUR SOUP", "100"),
        ("CHICKEN MANCHOW SOUP", "130"),
        ("CHICKEN SWEET CORN SOUP", "130"),
        ("CHICKEN HOT AND SOUR SOUP", "130"),
    ],
    "NOODLES": [
        ("VEG HAKKA NOODLES", "80"),
        ("VEG SCHEZWAN NOODLES", "90"),
        ("PANEER CHOWMIN", "90"),
        ("MUSHROOM CHOWMIN", "90"),
        ("MIX CHOWMIN VEG", "120"),
        ("MIX CHOWMIN NON VEG", "140"),
        ("CHICKEN CHOWMIN", "120"),
        ("EGG CHOWMIN", "90"),
        ("CHICKEN SCHEWAN NOODLE", "130"),
        ("VEG SINGAPURI NOODLES", "120"),
    ],
    "ROLL": [
        ("VEG ROLL", "50"),
        ("VEG PANEER ROLL", "80"),
        ("VEG MUSHROOM ROLL", "80"),
        ("VEG MIXED ROLL", "120"),
        ("EGG ROLL", "60"),
        ("DOUBLE EGG CHICKEN ROLL", "90"),
        ("NON VEG MIXED ROLL", "130"),
        ("KEBAB ROLL SINGLE EGG", "90"),
        ("KEBAB ROLL DOUBLE EGG", "120"),
    ],
    "BIRIYANI": [
        ("CHICKEN DUM BIRIYANI", "130"),
        ("CHICKEN DUM BIRIYANI COUPLE", "240"),
        ("CHICKEN DUM BIRIYANI FAMILY", "460"),
        ("MUTTON DUM BIRIYANI", "220"),
        ("EGG BIRIYANI", "90"),
        ("VEG BIRIYANI", "90"),
        ("VEG PANEER/MUSHROOM", "110"),
        ("MUGHLAI BIRIYANI", "180"),
        ("LOLLIPOP BIRIYANI", "200"),
    ],
    "DAL": [
        ("DAL TADKA", "50/80"),
        ("DAL MAKHANI", "100/150"),
        ("DAL FRY", "60/80"),
        ("DAL BUTTER FRY", "70/100"),
        ("PANEER TADKA", "70/100"),
    ],
    "MUTTON": [
        ("MUTTON CURRY HOMESTYLE", "220"),
        ("MUTTON MASALA", "220"),
        ("MUTTON DUM KA MASALA", "220"),
        ("MUTTON AFGHANI", "240"),
        ("METHI MUTTON", "220"),
        ("MUTTON ROGAN JOSH", "220"),
        ("MUTTON KORMA", "250"),
        ("MUTTON BHUNA MASALA", "250"),
        ("MUTTON KASA", "220"),
    ],
    "BEVERAGES": [
        ("MINERAL WATER SMALL", "10"),
        ("MINERAL WATER BIG", "20"),
        ("LASSI SALT/SWEET", "40"),
        ("MASALA COLD DRINKS", "30"),
        ("LEMON SODA SWEET/SALT", "30"),
        ("TEA", "10"),
        ("MASALA TEA", "20"),
    ]
}

from app.models.orders import Order, OrderItem, OrderItemModifier
from app.models.cart import Cart, CartItem, CartItemModifier
from app.models.customers import TableSession
from app.models.tenancy import Branch, Table
from app.models.menu import MenuCategory, MenuItem, MenuItemVariant, SpiceLevel

# Target branch
BRANCH_ID = uuid.UUID("70d0ca23-a03a-4d7b-a262-f075593cdde7")

VEG_CATEGORIES = ["INDIAN VEG CURRY", "VEG STARTER", "ROTI", "DAL", "SOUP", "RICE", "THALI", "BEVERAGES"]

async def seed_menu():
    engine = create_async_engine(settings.DATABASE_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as db:
        print("Clearing old menu data and related dependencies for this branch...")
        
        # 1. Clean Cart & Order data referencing this branch's menu items
        # First, find all menu items for this branch
        items_res = await db.execute(select(MenuItem.id).where(MenuItem.branch_id == BRANCH_ID))
        item_ids = items_res.scalars().all()
        
        if item_ids:
            print(f"Found {len(item_ids)} old items. Cleaning dependencies...")
            
            # Delete Cart Item dependencies
            await db.execute(delete(CartItemModifier).where(CartItemModifier.cart_item_id.in_(
                select(CartItem.id).where(CartItem.menu_item_id.in_(item_ids))
            )))
            await db.execute(delete(CartItem).where(CartItem.menu_item_id.in_(item_ids)))
            
            # Delete Order Item dependencies
            await db.execute(delete(OrderItemModifier).where(OrderItemModifier.order_item_id.in_(
                select(OrderItem.id).where(OrderItem.menu_item_id.in_(item_ids))
            )))
            await db.execute(delete(OrderItem).where(OrderItem.menu_item_id.in_(item_ids)))
            
            # Delete Menu Item Variants
            await db.execute(delete(MenuItemVariant).where(MenuItemVariant.menu_item_id.in_(item_ids)))
            # Finally delete items
            await db.execute(delete(MenuItem).where(MenuItem.id.in_(item_ids)))

        # 2. Clean Categories
        await db.execute(delete(MenuCategory).where(MenuCategory.branch_id == BRANCH_ID))
        
        await db.commit()
        print("🧹 Emptied old menu data and dependencies.")

        sort_index = 0
        for cat_name, items in MENU_DATA.items():
            sort_index += 10
            
            # Create Category
            new_cat = MenuCategory(
                branch_id=BRANCH_ID,
                name=cat_name,
                sort_order=sort_index,
                is_active=True
            )
            db.add(new_cat)
            await db.flush() # get id
            
            # Add Items
            for name, price_str in items:
                # Determine pricing/variants
                price_parts = price_str.split("/")
                base_price = float(price_parts[0])
                
                # Check Veg/Non-Veg
                name_upper = name.upper()
                is_veg = False
                if cat_name in VEG_CATEGORIES or "VEG" in name_upper or "PANEER" in name_upper or "MUSHROOM" in name_upper or "ALOO" in name_upper or "DAL" in name_upper:
                    if "CHICKEN" not in name_upper and "NON VEG" not in name_upper:
                        is_veg = True
                
                m_item = MenuItem(
                    branch_id=BRANCH_ID,
                    category_id=new_cat.id,
                    name=name,
                    base_price=base_price,
                    gst_percent=5, # Standard 5% GST
                    is_veg=is_veg,
                    is_available=True
                )
                db.add(m_item)
                await db.flush()
                
                # If there are split prices, add variants
                if len(price_parts) == 2:
                    v1 = MenuItemVariant(menu_item_id=m_item.id, name="Half", price=base_price)
                    v2 = MenuItemVariant(menu_item_id=m_item.id, name="Full", price=float(price_parts[1]))
                    db.add(v1)
                    db.add(v2)
                    
        await db.commit()
        print("✅ Menu perfectly inserted into database!")

asyncio.run(seed_menu())
