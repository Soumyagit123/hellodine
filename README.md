# HelloDine 🍽️
> **Next-Generation AI Restaurant Operating System**: Tablet & Mobile Kiosk, WhatsApp Ordering, Voice AI Waiter, Live Kitchen Display (KDS), Cashier Billing & GST Invoicing.

---

## 🌟 Overview

**HelloDine** is a comprehensive, production-grade restaurant automation SaaS engineered for modern hospitality. It transforms dining through dual-channel customer ordering (Interactive Tablet/Mobile Web Kiosk + Conversational WhatsApp Bot), real-time kitchen orchestration, and instant cashier billing.

### Key Highlights
- **🤖 Dual-Channel Customer Ordering**:
  - **Table Kiosk UI (`/table/:token` & `/kiosk`)**: Rich touch ordering, multi-dish selection, spice & modifier customization, voice input, AI assistant conversation, and interactive birthday celebrations.
  - **WhatsApp Cloud API Bot**: Fully conversational ordering and inquiry powered by LangGraph & Google Gemini 2.5 Flash.
- **⚡ Voice AI Waiter**:
  - Browser Speech Recognition + Web Speech Synthesis with human prosody.
  - Instant zero-token intent matching (<1ms) for common tasks (Cart, Best Dishes, Order Status, Bill Check, Jokes, Cartoons).
  - Dynamic Gemini LLM fallback for free-form customer inquiries, dietary preferences, and flavor descriptions.
- **👨‍🍳 Real-time Kitchen Display System (KDS / `/orders`)**:
  - Live Kanban board (`New` $\to$ `Accepted` $\to$ `Preparing` $\to$ `Ready` $\to$ `Served`).
  - Sub-millisecond WebSocket updates across kitchen screens and table tablets with status regression guards and announcement deduplication.
- **💰 Cashier Billing & GST Invoicing (`/billing`)**:
  - Real-time session billing, item breakdown, automatic CGST & SGST calculation (compliant with Indian tax standards), dynamic table-level UPI QR codes, and instant table turnover.
- **🏢 Multi-Tenant SaaS Hierarchy**:
  - Multi-tenant architecture (`Restaurant` $\to$ `Branch` $\to$ `Tables` $\to$ `Staff`).
  - Role-Based Access Control (`SYSTEM_ADMIN`, `SUPER_ADMIN`, `BRANCH_ADMIN`, `CASHIER`, `CHEF`).

---

## 🏗️ Architecture & Tech Stack

```
HelloDine/
├── backend/                  # FastAPI REST & WebSocket Backend
│   ├── app/
│   │   ├── bot/              # LangGraph Conversational AI State Graph
│   │   │   ├── nodes/        # Intent router, cart/order, billing, entertainment, chat
│   │   │   └── wa_sender.py  # WhatsApp Cloud API integration
│   │   ├── models/           # SQLAlchemy Async PostgreSQL ORM Models
│   │   ├── routers/          # API Routers (kiosk, orders, billing, menu, auth, admin)
│   │   └── services/         # Order, billing, cache, and WebSocket connection manager
│   ├── requirements.txt
│   └── seed.py               # Database seeder
└── frontend/                 # React 18 + Vite + TypeScript PWA
    ├── src/
    │   ├── pages/
    │   │   ├── kiosk/        # Customer Table Kiosk & Voice AI Waiter
    │   │   ├── OrdersBoard/  # Live Kitchen Kanban Board (KDS)
    │   │   ├── Billing/      # Cashier Invoicing & Payments
    │   │   └── admin/        # Menu, Branch, Staff, Table Management
    │   └── api/              # Axios & WebSocket client
    └── package.json
```

### Core Technologies
- **Backend**: FastAPI (Python 3.12+), SQLAlchemy 2.0 (Async), PostgreSQL (Supabase / local asyncpg), Redis / In-Memory Ultra-Fast Cache, WebSockets.
- **AI & NLP**: LangGraph, Google Gemini 2.5 Flash (`langchain-google-genai`), Zero-Token NLU Router.
- **Frontend**: React 18, Vite, TypeScript, Lucide Icons, Canvas Confetti, Web Speech API.
- **Integrations**: Meta WhatsApp Cloud API, Indian UPI Payment QR Specifications, Indian GST Compliance.

---

## 🚀 Getting Started Locally

### Prerequisites
- Python 3.11+ or 3.12+
- Node.js 18+ and npm
- PostgreSQL database (or Supabase project)

---

### 1. Backend Setup

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
# On Windows:
venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
cp ../.env.example .env
```

#### Required Environment Variables (`.env`):
```ini
DATABASE_URL=postgresql+asyncpg://<user>:<password>@<host>:<port>/<dbname>
SECRET_KEY=your_secure_jwt_secret
GEMINI_API_KEY=your_gemini_api_key

# Optional for WhatsApp Cloud API
WA_PHONE_NUMBER_ID=your_meta_phone_id
WA_ACCESS_TOKEN=your_meta_system_user_token
WA_WEBHOOK_VERIFY_TOKEN=hellodine
```

#### Seed Initial Data & Start Server:
```bash
# Seed initial demo restaurant, tables, categories, menu items, and admin accounts
python seed.py

# Start backend server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
Backend API will be live at `http://localhost:8000` (Swagger docs: `http://localhost:8000/docs`).

---

### 2. Frontend Setup

```bash
cd frontend

# Install packages
npm install

# Build & run development server
npm run dev
```
Frontend application will be accessible at `http://localhost:5173`.

---

## 🔑 Default Credentials (Seeded)

| Role | Username / Mobile | Password / PIN | Access Scope |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `+91 9000000001` | `admin123` | Full System & All Branches |
| **Branch Admin** | `+91 9000000002` | `branch123` | Branch Menu, Staff, Reports |
| **Cashier** | `+91 9000000003` | `cashier123` | Billing, Payments, Orders |
| **Kitchen Chef** | `+91 9000000004` | `chef123` | Kitchen Orders Board (KDS) |

**Customer Tablet Kiosk**:
Open directly via: `http://localhost:5173/kiosk` or through generated table tokens: `http://localhost:5173/table/<QR_TOKEN>`.

---

## 🌐 Production Deployment Guide

You can deploy the full stack cleanly from this **single repository** (Monorepo):

### A. Deploy Frontend on Vercel
1. Sign in to [Vercel](https://vercel.com) and click **Add New** $\to$ **Project**.
2. Select your repository: `Soumyagit123/Hellodine`.
3. In **Project Settings**:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `frontend`
4. In **Environment Variables**, add:
   - `VITE_API_URL`: `https://<your-backend-domain>/api`
   - `VITE_WS_URL`: `wss://<your-backend-domain>/api`
5. Click **Deploy**.

### B. Deploy Backend on Render / Railway

#### Option 1: Render
1. Create a new **Web Service** on [Render](https://render.com).
2. Connect `Soumyagit123/Hellodine`.
3. Configure:
   - **Root Directory**: `backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Add environment variables (`DATABASE_URL`, `SECRET_KEY`, `GEMINI_API_KEY`, etc.).

#### Option 2: Railway
1. Create a new project on [Railway](https://railway.app) from GitHub repo.
2. In **Settings** $\to$ **Root Directory**, set `/backend`.
3. Set **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}`.
4. Set required variables in the **Variables** tab.

---

## 🛡️ Production Optimizations & Reliability
- **Sub-Second Order Flow**: Eliminates N+1 database roundtrips by batching cart lines and pre-validating prices.
- **Monotonic Status Pipeline**: Strict lifecycle rank (`NEW` $\to$ `ACCEPTED` $\to$ `PREPARING` $\to$ `READY` $\to$ `SERVED`) ensures WebSocket announcements are never repeated or regressed by stale polling queries.
- **Zero-Token Intent Fast-Path**: Routine queries (Bill, Top 3, Status, Cart) respond in <1ms without hitting LLM quotas.
- **Idempotency & Race Protection**: Deduplicated WebSocket broadcast keys and optimistic button locks eliminate double order submission or duplicate kitchen ticket printing.

---

## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.
