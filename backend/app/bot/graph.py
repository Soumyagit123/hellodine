"""LangGraph StateGraph — wires all bot nodes together."""
from langgraph.graph import StateGraph, END
from app.bot.state import BotState
from app.bot.nodes.ingest_and_session import ingest_webhook, resolve_session
from app.bot.nodes.intent import detect_language, intent_router
from app.bot.nodes.menu_and_format import menu_retrieval, response_formatter
from app.bot.nodes.cart_and_order import cart_executor, checkout_guard_node, kitchen_dispatch
from app.bot.nodes.billing import bill_generator
from app.bot.nodes.chat import restaurant_chat
from app.bot.nodes.menu_and_format import item_info_node


def route_after_intent(state: BotState) -> str:
    intent = state.get("intent", "OTHER")
    error = state.get("error")

    if error:
        return "response_formatter"
    
    # 1. Pairing / Welcome
    if intent == "QR_SCAN":
        return "menu_retrieval"
    
    # 2. Browsing
    if intent == "BROWSE":
        return "menu_retrieval"
    if intent == "ITEM_INFO":
        return "item_info"
    
    # 3. Cart / Order
    if intent in ("ADD_ITEM", "REMOVE_ITEM", "UPDATE_QTY", "CART_VIEW"):
        return "cart_executor"
    if intent == "CONFIRM_SUMMARY":
        return "checkout_guard"
    if intent == "PLACE_ORDER":
        return "kitchen_dispatch"
    
    # 4. Bill / Chat
    if intent == "BILL":
        return "bill_generator"
    if intent == "OTHER":
        return "restaurant_chat"
    
    return "response_formatter"


def route_after_session(state: BotState) -> str:
    if state.get("error"):
        return "response_formatter"
    return "detect_language"


def route_after_cart(state: BotState) -> str:
    intent = state.get("intent")
    if intent == "BROWSE":
        return "menu_retrieval"
    return "response_formatter"


def build_graph() -> StateGraph:
    g = StateGraph(BotState)

    # Register all nodes
    g.add_node("ingest_webhook", ingest_webhook)
    g.add_node("resolve_session", resolve_session)
    g.add_node("detect_language", detect_language)
    g.add_node("intent_router", intent_router)
    g.add_node("menu_retrieval", menu_retrieval)
    g.add_node("item_info", item_info_node)
    g.add_node("cart_executor", cart_executor)
    g.add_node("checkout_guard", checkout_guard_node)
    g.add_node("kitchen_dispatch", kitchen_dispatch)
    g.add_node("bill_generator", bill_generator)
    g.add_node("restaurant_chat", restaurant_chat)
    g.add_node("response_formatter", response_formatter)

    # Entry point
    g.set_entry_point("ingest_webhook")

    # Edges
    g.add_edge("ingest_webhook", "resolve_session")
    g.add_conditional_edges("resolve_session", route_after_session, {
        "detect_language": "detect_language",
        "response_formatter": "response_formatter",
    })
    g.add_edge("detect_language", "intent_router")
    g.add_conditional_edges("intent_router", route_after_intent, {
        "menu_retrieval": "menu_retrieval",
        "item_info": "item_info",
        "cart_executor": "cart_executor",
        "checkout_guard": "checkout_guard",
        "kitchen_dispatch": "kitchen_dispatch",
        "bill_generator": "bill_generator",
        "restaurant_chat": "restaurant_chat",
        "response_formatter": "response_formatter",
    })

    # Action Edges
    g.add_conditional_edges("cart_executor", route_after_cart, {
        "menu_retrieval": "menu_retrieval",
        "response_formatter": "response_formatter"
    })

    for node in ("menu_retrieval", "item_info", "checkout_guard", "kitchen_dispatch", "bill_generator", "restaurant_chat"):
        g.add_edge(node, "response_formatter")

    g.add_edge("response_formatter", END)

    return g.compile()


# Compiled graph singleton used by webhook
compiled_graph = build_graph()
