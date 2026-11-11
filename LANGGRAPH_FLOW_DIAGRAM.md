# Hello Dine: LangGraph Logic Flow (Node-Edge Diagram)

This document visualizes the "Brain" of the WhatsApp bot. It follows a state-machine architecture where each **Node** (box) is a processing step and each **Edge** (arrow) is a logical transition.

## 1. Visual Flow (Mermaid)

The diagram below shows the 1:1 mapping of the processing nodes defined in `backend/app/bot/graph.py`.

```mermaid
graph TD
    %% Nodes
    Start((● Inbound Message))
    Ingest[Ingest Webhook]
    Resolve[Resolve Session]
    Lang[Detect Language]
    Intent{Intent Router}
    
    %% Functional Nodes
    Menu[Menu Retrieval]
    Info[Item Info]
    Cart[Cart Executor]
    Guard[Checkout Guard]
    Dispatch[Kitchen Dispatch]
    Bill[Bill Generator]
    Chat[Restaurant AI Chat]
    
    %% Finalization
    Format[Response Formatter]
    End((○ Send Reply))

    %% Edges (Flow)
    Start --> Ingest
    Ingest --> Resolve
    
    Resolve -->|Session Found| Lang
    Resolve -->|No Session/Error| Format
    
    Lang --> Intent
    
    %% Intent Routing (Conditional Edges)
    Intent -->|BROWSE / QR_SCAN| Menu
    Intent -->|ITEM_INFO| Info
    Intent -->|ADD / REMOVE / VIEW| Cart
    Intent -->|CONFIRM_SUMMARY| Guard
    Intent -->|PLACE_ORDER| Dispatch
    Intent -->|BILL| Bill
    Intent -->|OTHER / HELP| Chat

    %% State Transitions
    Cart -->|Browse More| Menu
    Cart -->|Done| Format
    
    Menu --> Format
    Info --> Format
    Guard --> Format
    Dispatch --> Format
    Bill --> Format
    Chat --> Format

    Format --> End

    %% Styling
    style Intent fill:#58a,stroke:#333,stroke-width:2px,color:#fff
    style Start fill:#2ecc71,stroke:#333,color:#fff
    style End fill:#e67e22,stroke:#333,color:#fff
    style Cart fill:#f1c40f,stroke:#333
    style Menu fill:#3498db,stroke:#333,color:#fff
```

## 2. Full Architecture Visualization

![LangGraph Logic Flow](/C:/Users/soumy/.gemini/antigravity/brain/a115c77d-2295-4a36-9fcf-e7cc99d2b480/langgraph_logic_flow_diagram_1772730555085.png)

## 3. Node & Edge Definitions

| Node Name | Category | Purpose |
| :--- | :--- | :--- |
| **Ingest Webhook** | Entry | Parses the raw JSON from Meta/WhatsApp API. |
| **Resolve Session** | Security | Pairs the phone number to a specific Table/Branch. |
| **Intent Router** | Brain | **Powered by Gemini AI**: Decides exactly what the user wants. |
| **Cart Executor** | Action | Logic for `Add to Cart`, `Remove`, or `Update Quantity`. |
| **Checkout Guard** | Safety | Validates item availability and total amounts before ordering. |
| **Kitchen Dispatch** | Integration | Sends the order to the **Chef's Kitchen Board** via WebSockets. |
| **Response Formatter** | Output | Converts data into high-end WhatsApp Lists or Buttons. |

## 4. Logical Edges (Transitions)
- **Conditional Edge**: The `Intent Router` acts as a traffic controller. If the AI detects "I'm hungry", it points the edge towards `Menu Retrieval`.
- **Loop Edge**: After adding an item to the `Cart`, the edge can point back to `Menu Retrieval` to encourage the user to order more.
- **Terminal Edge**: Every flow eventually converges at `Response Formatter` to ensure the customer always gets a reply.

---
*Technical System Diagram - Hello Dine v2.0*
