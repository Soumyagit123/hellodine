import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import api, { WS_BASE_URL } from "../../api/client";

type MenuCategory = {
    id: string;
    name: string;
    sort_order: number;
    estimated_prep_minutes?: number | null;
};

type MenuItem = {
    id: string;
    category_id: string;
    name: string;
    description?: string | null;
    base_price: number;
    gst_percent: number;
    is_veg: boolean;
    is_jain: boolean;
    is_bestseller?: boolean;
    spice_level?: string | null;
};

type CartItem = {
    id: string;
    menu_item_id: string;
    name: string;
    is_veg: boolean;
    gst_percent: number;
    quantity: number;
    unit_price: number;
    line_total: number;
    notes?: string | null;
};

type OrderItem = {
    id: string;
    menu_item_id: string;
    name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    notes?: string | null;
};

type Order = {
    id: string;
    order_number: string;
    status: string;
    subtotal: number;
    cgst_amount: number;
    sgst_amount: number;
    total: number;
    created_at: string;
    items: OrderItem[];
};

type ChatMessage = {
    id: string;
    sender: "bot" | "user";
    text: string;
    buttons?: { id: string; title: string }[];
    time: string;
};

// High-appetizing food photography + 100% reliable SVG data-URI fallback
function getFoodFallbackSvg(name: string, isVeg: boolean): string {
    const n = name.toLowerCase();
    let emoji = isVeg ? "🥘" : "🍗";
    if (n.includes("paneer")) emoji = "🧀";
    else if (n.includes("chicken") || n.includes("murgh") || n.includes("tangdi") || n.includes("lollipop")) emoji = "🍗";
    else if (n.includes("fish") || n.includes("prawn") || n.includes("apollo")) emoji = "🐟";
    else if (n.includes("egg") || n.includes("omelette") || n.includes("bhurji")) emoji = "🍳";
    else if (n.includes("roti") || n.includes("naan") || n.includes("kulcha") || n.includes("paratha")) emoji = "🫓";
    else if (n.includes("rice") || n.includes("biryani") || n.includes("pulao")) emoji = "🍛";
    else if (n.includes("thali") || n.includes("meal")) emoji = "🍱";
    else if (n.includes("dal") || n.includes("curry") || n.includes("masala")) emoji = "🍲";
    else if (n.includes("tandoor") || n.includes("tikka") || n.includes("kebab")) emoji = "🍢";
    else if (n.includes("soda") || n.includes("lassi") || n.includes("drink") || n.includes("chai")) emoji = "🥤";
    else if (n.includes("sweet") || n.includes("jamun") || n.includes("brownie") || n.includes("ice")) emoji = "🍨";

    const bg1 = isVeg ? "#133a2b" : "#3d161b";
    const bg2 = isVeg ? "#0c221a" : "#220c10";
    const accent = isVeg ? "#23d18b" : "#ff6b35";
    const safeTitle = name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 22);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240">
        <defs>
            <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="${bg1}"/>
                <stop offset="100%" stop-color="${bg2}"/>
            </linearGradient>
        </defs>
        <rect width="400" height="240" fill="url(#g)"/>
        <circle cx="200" cy="100" r="54" fill="${accent}" fill-opacity="0.16" stroke="${accent}" stroke-opacity="0.35" stroke-width="2"/>
        <text x="200" y="118" font-size="54" text-anchor="middle">${emoji}</text>
        <text x="200" y="198" font-family="Inter, sans-serif" font-size="18" font-weight="700" fill="#ffffff" text-anchor="middle">${safeTitle}</text>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getFoodImage(name: string, isVeg: boolean): string {
    const n = name.toLowerCase();
    if (n.includes("paneer") && n.includes("tikka"))
        return "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?auto=format&fit=crop&w=600&q=80";
    if (n.includes("paneer"))
        return "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=600&q=80";
    if (n.includes("fish") || n.includes("prawn") || n.includes("apollo"))
        return "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=600&q=80";
    if (n.includes("egg") || n.includes("omelette") || n.includes("bhurji"))
        return "https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=600&q=80";
    if (n.includes("chicken") || n.includes("murgh") || n.includes("lollipop") || n.includes("wings"))
        return "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=600&q=80";
    if (n.includes("biryani") || n.includes("rice") || n.includes("jeera") || n.includes("pulao"))
        return "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=600&q=80";
    if (n.includes("naan") || n.includes("roti") || n.includes("kulcha") || n.includes("paratha"))
        return "https://images.unsplash.com/photo-1626074353765-517a681e40be?auto=format&fit=crop&w=600&q=80";
    if (n.includes("thali") || n.includes("combo"))
        return "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=600&q=80";
    if (n.includes("dal") || n.includes("makhani") || n.includes("tadka") || n.includes("curry") || n.includes("masala"))
        return "https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=600&q=80";
    if (n.includes("gobi") || n.includes("manchurian") || n.includes("chilli") || n.includes("noodle") || n.includes("65"))
        return "https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=600&q=80";
    if (n.includes("corn") || n.includes("crispy") || n.includes("starter") || n.includes("fries") || n.includes("pakoda"))
        return "https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?auto=format&fit=crop&w=600&q=80";
    if (n.includes("tandoor") || n.includes("kebab") || n.includes("tikka"))
        return "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=600&q=80";
    if (n.includes("soda") || n.includes("lime") || n.includes("mojito") || n.includes("coke") || n.includes("drink"))
        return "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=600&q=80";
    if (n.includes("lassi") || n.includes("mango") || n.includes("shake") || n.includes("smoothie"))
        return "https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=600&q=80";
    if (n.includes("gulab") || n.includes("jamun") || n.includes("sweet") || n.includes("brownie") || n.includes("ice"))
        return "https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=600&q=80";

    return isVeg
        ? "https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=600&q=80"
        : "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=600&q=80";
}


// Reliable Cartoon Video list (with YouTube Embed + Direct MP4 fallback + Custom URL support)
const CARTOON_VIDEOS = [
    {
        id: "c1",
        title: "🐱🐭 Tom & Jerry — Classic Cartoon Compilation",
        subtitle: "Warner Bros Kids Official",
        type: "youtube" as const,
        youtubeEmbed: "https://www.youtube.com/embed/t0Q2otsqC4I?autoplay=1&rel=0",
        mp4Fallback: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        badge: "Kids #1 Hit",
    },
    {
        id: "c2",
        title: "🐻❄️ Masha and The Bear — Funny Episodes",
        subtitle: "Family & Kids Cartoon",
        type: "youtube" as const,
        youtubeEmbed: "https://www.youtube.com/embed/KYniUCGPGLs?autoplay=1&rel=0",
        mp4Fallback: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
        badge: "Popular",
    },
    {
        id: "c3",
        title: "🐰 Big Buck Bunny — Forest Adventure (Direct HD Video)",
        subtitle: "100% Offline/Direct MP4 Stream",
        type: "mp4" as const,
        youtubeEmbed: "https://www.youtube.com/embed/aqz-KE-bpKQ?autoplay=1&rel=0",
        mp4Fallback: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        badge: "Direct MP4",
    },
    {
        id: "c4",
        title: "🐉 Sintel & The Baby Dragon (Direct HD Video)",
        subtitle: "Animated Fantasy Short Film",
        type: "mp4" as const,
        youtubeEmbed: "https://www.youtube.com/embed/eRsGyueVLvQ?autoplay=1&rel=0",
        mp4Fallback: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
        badge: "Direct MP4",
    },
];

const ORDER_STAGES = ["NEW", "ACCEPTED", "PREPARING", "READY", "SERVED"];

// Synthesize Happy Birthday Melody using Web Audio API
function playHappyBirthdayMelody(): () => void {
    try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();

        const melody: [number, number][] = [
            [261.63, 0.35], [261.63, 0.25], [293.66, 0.55], [261.63, 0.55], [349.23, 0.55], [329.63, 0.9],
            [261.63, 0.35], [261.63, 0.25], [293.66, 0.55], [261.63, 0.55], [392.00, 0.55], [349.23, 0.9],
            [261.63, 0.35], [261.63, 0.25], [523.25, 0.55], [440.00, 0.55], [349.23, 0.55], [329.63, 0.55], [293.66, 0.85],
            [466.16, 0.35], [466.16, 0.25], [440.00, 0.55], [349.23, 0.55], [392.00, 0.55], [349.23, 1.0],
        ];

        let currentTime = ctx.currentTime + 0.1;
        melody.forEach(([freq, duration]) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "triangle";
            osc.frequency.setValueAtTime(freq, currentTime);

            gain.gain.setValueAtTime(0.001, currentTime);
            gain.gain.exponentialRampToValueAtTime(0.28, currentTime + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, currentTime + duration - 0.03);

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(currentTime);
            osc.stop(currentTime + duration);

            currentTime += duration + 0.05;
        });

        return () => {
            try {
                ctx.close();
            } catch {
                // ignore
            }
        };
    } catch {
        return () => {};
    }
}

export default function TableKiosk() {
    const { token: routeToken } = useParams<{ token?: string }>();
    const [searchParams] = useSearchParams();
    const queryTableId = searchParams.get("table_id") || "";
    const queryToken = searchParams.get("token") || routeToken || "";

    const [availableBranches, setAvailableBranches] = useState<any[]>([]);
    const [selectedTableId, setSelectedTableId] = useState<string>(
        queryTableId || localStorage.getItem("hd_kiosk_table_id") || ""
    );
    const [activeToken, setActiveToken] = useState<string>(
        queryToken || localStorage.getItem("hd_kiosk_token") || ""
    );

    // Kiosk Session State
    const [sessionData, setSessionData] = useState<any | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>("");

    // Menu Filters
    const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
    const [vegFilter, setVegFilter] = useState<"ALL" | "VEG" | "NONVEG">("ALL");
    const [bestsellerOnly, setBestsellerOnly] = useState<boolean>(false);
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [aiMatchedItemIds, setAiMatchedItemIds] = useState<string[] | null>(null);

    // AI Bot Chat & Voice State
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState<string>("");
    const [botThinking, setBotThinking] = useState<boolean>(false);
    const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
    const [isListening, setIsListening] = useState<boolean>(false);
    const chatEndRef = useRef<HTMLDivElement | null>(null);
    const recognitionRef = useRef<any>(null);
    const voiceWaitTimerRef = useRef<any>(null);
    const voiceAccumulatedRef = useRef<string>("");
    // Single-dispatch latch per speech session: ensures a voice turn can dispatch AT MOST ONCE
    const voiceDispatchedForSessionRef = useRef<boolean>(false);
    // Cached AudioContext to unlock mobile/Android audio on user gesture
    const audioContextRef = useRef<AudioContext | null>(null);

    // Warm up and unlock mobile/tablet audio channel on direct user touch/click
    function unlockMobileAudio() {
        try {
            if (typeof window !== "undefined") {
                const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
                if (AudioCtx) {
                    if (!audioContextRef.current) {
                        audioContextRef.current = new AudioCtx();
                    }
                    if (audioContextRef.current.state === "suspended") {
                        audioContextRef.current.resume();
                    }
                }
                // Prime SpeechSynthesis with a silent empty utterance to unlock Android TTS engine
                if ("speechSynthesis" in window) {
                    const silentUtterance = new SpeechSynthesisUtterance(" ");
                    silentUtterance.volume = 0.01;
                    silentUtterance.rate = 2;
                    window.speechSynthesis.speak(silentUtterance);
                }
            }
        } catch {
            // ignore audio unlock issues
        }
    }
    // Guard against simultaneous or rapid duplicate chat sends (debounces voice + form submits)
    const chatInFlightRef = useRef<boolean>(false);
    const lastChatSubmissionTimeRef = useRef<number>(0);
    const lastChatSubmissionNormRef = useRef<string>("");

    // Modals & Entertainment State
    const [showCartoonModal, setShowCartoonModal] = useState<boolean>(false);
    const [activeCartoon, setActiveCartoon] = useState(CARTOON_VIDEOS[0]);
    const [videoMode, setVideoMode] = useState<"youtube" | "mp4">("mp4");
    const [customVideoUrl, setCustomVideoUrl] = useState<string>("");
    const [jokeBanner, setJokeBanner] = useState<string | null>(null);

    const [showBirthdayPrompt, setShowBirthdayPrompt] = useState<boolean>(false);
    const [birthdayInputName, setBirthdayInputName] = useState<string>("");
    const [birthdayOverlay, setBirthdayOverlay] = useState<{
        name: string;
        wish: string;
        restaurant_name: string;
    } | null>(null);
    const stopMusicRef = useRef<(() => void) | null>(null);

    // Left-side Order Confirmation Modal (Normal UI -> AI Speaks & Confirms)
    const [showOrderConfirmModal, setShowOrderConfirmModal] = useState<boolean>(false);
    const [showCartRemoveModal, setShowCartRemoveModal] = useState<boolean>(false);
    const [placingOrder, setPlacingOrder] = useState<boolean>(false);

    // Bill & UPI QR Modal (Merchant UPI is locked from backend/env — customers cannot edit it)
    const [showBillModal, setShowBillModal] = useState<boolean>(false);
    const [payingQR, setPayingQR] = useState<boolean>(false);
    const [upiRefInput, setUpiRefInput] = useState<string>("");
    const [voiceTranscriptNotice, setVoiceTranscriptNotice] = useState<string>("");

    // 3D Welcome & Customer Check-In Screen State (New Session Landing)
    const [checkedInSessionId, setCheckedInSessionId] = useState<string>(() => {
        return sessionStorage.getItem("hd_kiosk_checkedin_session") || "";
    });
    const [welcomeName, setWelcomeName] = useState<string>("");
    const [welcomeDob, setWelcomeDob] = useState<string>("");
    const [welcomeIsBirthday, setWelcomeIsBirthday] = useState<boolean>(false);
    const [checkingIn, setCheckingIn] = useState<boolean>(false);

    // Goodbye & Session Expired Screen
    const [goodbyeScreen, setGoodbyeScreen] = useState<{
        bill_number: string;
        amount_paid: number;
        subtotal: number;
        cgst: number;
        sgst: number;
        message: string;
        countdown: number;
    } | null>(null);

    // Preload & select the most natural, human-like Indian English Neural Voice available in the browser
    const bestIndianVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

    function pickBestIndianVoice(): SpeechSynthesisVoice | null {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
        const voices = window.speechSynthesis.getVoices() || [];
        if (voices.length === 0) return null;

        // Priority 1: High quality English (India) Natural / Neural voices
        const enInPriorityNames = [
            "microsoft neerja online (natural)",
            "microsoft swara online (natural)",
            "microsoft prabhat online (natural)",
            "microsoft madhur online (natural)",
            "google english (india)",
            "google en-in",
            "en-in-language",
            "en_in",
            "neerja",
            "swara",
            "prabhat",
            "veena",
            "rishi",
            "lekha",
            "sangeeta",
        ];

        for (const target of enInPriorityNames) {
            const match = voices.find(
                (v) =>
                    v.name.toLowerCase().includes(target) &&
                    (v.lang.toLowerCase().replace(/_/g, "-").startsWith("en") || !v.lang)
            );
            if (match) return match;
        }

        // Priority 2: Any voice strictly with locale "en-IN" or "en_IN"
        const enInStrict = voices.find((v) => {
            const l = (v.lang || "").toLowerCase().replace(/_/g, "-");
            return l === "en-in" || l.startsWith("en-in");
        });
        if (enInStrict) return enInStrict;

        // Priority 3: Any other English voice (en-US, en-GB, etc.)
        const anyEnglish = voices.find((v) => {
            const l = (v.lang || "").toLowerCase().replace(/_/g, "-");
            return l.startsWith("en-") || l === "en";
        });
        if (anyEnglish) return anyEnglish;

        // Fallback: Default system voice (never pick regional non-English without checking)
        return voices.find((v) => v.default) || voices[0];
    }

    useEffect(() => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
        const updateVoice = () => {
            bestIndianVoiceRef.current = pickBestIndianVoice();
        };
        updateVoice();
        window.speechSynthesis.onvoiceschanged = updateVoice;
        return () => {
            if ("speechSynthesis" in window) {
                window.speechSynthesis.onvoiceschanged = null;
            }
        };
    }, []);

    // Speak text using Browser SpeechSynthesis ONLY when explicitly requested, with warm Indian human prosody
    function speakText(rawText: string) {
        if (!voiceEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
        try {
            window.speechSynthesis.cancel();
            const clean = rawText
                .replace(/[*_~`#]/g, "")
                .replace(/─+/g, "")
                .replace(/₹\s*(\d+)/g, "Rupees $1")
                .replace(/×\s*(\d+)/g, "quantity $1")
                .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
                .replace(/\s+/g, " ")
                .trim();
            if (!clean) return;
            const utterance = new SpeechSynthesisUtterance(clean);
            const chosenVoice = bestIndianVoiceRef.current || pickBestIndianVoice();
            if (chosenVoice) {
                utterance.voice = chosenVoice;
                utterance.lang = chosenVoice.lang || "en-IN";
            } else {
                utterance.lang = "en-IN";
            }
            // Warm, natural conversational Indian cadence
            utterance.rate = 0.98;
            utterance.pitch = 1.0;
            // Android mobile voice engine bugfix: resume if paused before speaking
            if (window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
            }
            window.speechSynthesis.speak(utterance);
        } catch {
            // ignore speech errors
        }
    }

    function appendBotMessage(
        body: string,
        buttons?: { id: string; title: string }[],
        shouldSpeak = false,
        customVoiceText?: string
    ) {
        const msg: ChatMessage = {
            id: `bot-${Date.now()}-${Math.random()}`,
            sender: "bot",
            text: body,
            buttons,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, msg]);
        if (shouldSpeak) {
            speakText(customVoiceText || body);
        }
    }

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, botThinking]);

    function loadAvailableTables() {
        setLoading(true);
        setError("");
        api.get("/kiosk/tables-list")
            .then((res) => setAvailableBranches(res.data))
            .catch(() =>
                setError(
                    "Could not connect to Backend API at port 8000. Please make sure the FastAPI backend is running."
                )
            )
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        if (!activeToken && !selectedTableId) {
            loadAvailableTables();
        } else {
            startOrResumeSession(activeToken, selectedTableId, false);
        }
    }, [activeToken, selectedTableId]);

    async function startOrResumeSession(tok?: string, tblId?: string, forceNew = false) {
        setLoading(true);
        setError("");
        try {
            const payload: any = { force_new: forceNew };
            if (tok) payload.token = tok;
            else if (tblId) payload.table_id = tblId;

            const res = await api.post("/kiosk/session/start", payload);
            setSessionData(res.data);
            if (res.data?.orders) {
                seedOrderStatuses(res.data.orders);
            }
            setGoodbyeScreen(null);
            setShowBillModal(false);
            setShowOrderConfirmModal(false);
            setShowCartRemoveModal(false);
            setJokeBanner(null);

            const newSessId = res.data?.session?.id || "";
            const existingCustName = res.data?.customer?.name || "";
            const hasOrders = (res.data?.orders || []).length > 0;
            const isDefaultGuest = !existingCustName || /^Table\s+(?:T)?\d+\s+Guest$/i.test(existingCustName.trim());
            const savedCheckin = sessionStorage.getItem("hd_kiosk_checkedin_session");
            const isAlreadyCheckedIn = savedCheckin === newSessId;

            // Only skip welcome check-in IF this specific session was ALREADY checked in during this browser session,
            // or if it already has active placed orders. NEVER skip just because a previous customer's name exists!
            if (forceNew || isDefaultGuest) {
                sessionStorage.removeItem("hd_kiosk_checkedin_session");
                setCheckedInSessionId("");
                setWelcomeName("");
                setWelcomeDob("");
                setWelcomeIsBirthday(false);
            } else if (newSessId && (hasOrders || isAlreadyCheckedIn)) {
                sessionStorage.setItem("hd_kiosk_checkedin_session", newSessId);
                setCheckedInSessionId(newSessId);
            } else {
                sessionStorage.removeItem("hd_kiosk_checkedin_session");
                setCheckedInSessionId("");
                setWelcomeName("");
                setWelcomeDob("");
                setWelcomeIsBirthday(false);
            }

            if (tok) localStorage.setItem("hd_kiosk_token", tok);
            if (res.data?.table?.id) localStorage.setItem("hd_kiosk_table_id", res.data.table.id);

            const restName = res.data?.restaurant?.name || "HelloDine";
            const tableNum = res.data?.table?.table_number || "";
            // Do NOT auto-speak the long welcome paragraph on page load
            setMessages([
                {
                    id: `welcome-${Date.now()}`,
                    sender: "bot",
                    text: `Welcome to *${restName}* (Table T${tableNum})! 😊🍽️\n\n• Tap dishes on the left menu for instant adding to cart.\n• Or chat / tap 🎤 here to ask me anything, order by voice, or check your GST bill!`,
                    buttons: [
                        { id: "tell_joke", title: "😂 Hear a Joke" },
                        { id: "show_cartoons", title: "🎬 Kids Cartoons" },
                    ],
                    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                },
            ]);
        } catch (err: any) {
            setError(err.response?.data?.detail || "Could not start table session.");
        } finally {
            setLoading(false);
        }
    }

    // Strictly monotonic order status ranks: order lifecycle moves only forward
    const STATUS_RANK: Record<string, number> = {
        NEW: 1,
        ACCEPTED: 2,
        PREPARING: 3,
        READY: 4,
        SERVED: 5,
        CANCELLED: 99,
    };

    // Track last seen order statuses so even if WebSocket reconnects or updates via polling, chatbot always announces status changes
    const lastOrderStatusMapRef = useRef<Record<string, string>>({});
    // Track set of status announcements already made: `${orderId}:${status}` -> NEVER announce the same status twice!
    const announcedStatusKeysRef = useRef<Set<string>>(new Set());
    // Guard against background polling overwriting optimistic cart updates while an add/update API call is in flight
    const cartMutationCountRef = useRef<number>(0);
    const lastCartMutationTimeRef = useRef<number>(0);

    // Helper: Seed order statuses into ref tracking and mark them as already announced (used on session load/checkin)
    function seedOrderStatuses(ordersList: Order[]) {
        if (!ordersList || !Array.isArray(ordersList)) return;
        ordersList.forEach((o) => {
            if (!o?.id || !o?.status) return;
            const currentRank = STATUS_RANK[o.status] || 0;
            const existingStatus = lastOrderStatusMapRef.current[o.id];
            const existingRank = existingStatus ? (STATUS_RANK[existingStatus] || 0) : 0;
            if (!existingStatus || currentRank >= existingRank) {
                lastOrderStatusMapRef.current[o.id] = o.status;
            }
            // Mark current status and all prior statuses as already known/announced
            // so page load, customer login/checkin, or reconnect NEVER speaks stale past statuses!
            Object.keys(STATUS_RANK).forEach((st) => {
                if ((STATUS_RANK[st] || 0) <= currentRank) {
                    announcedStatusKeysRef.current.add(`${o.id}:${st}`);
                }
            });
        });
    }

    function announceOrderStatusIfNeeded(orderId: string, orderNumber: string, newStatus: string) {
        if (!orderId || !newStatus) return;
        const prevStatus = lastOrderStatusMapRef.current[orderId];
        const prevRank = prevStatus ? (STATUS_RANK[prevStatus] || 0) : 0;
        const newRank = STATUS_RANK[newStatus] || 0;

        // 1. Never regress status backwards (e.g. an out-of-order stale polling packet with NEW while current is ACCEPTED)
        if (newStatus !== "CANCELLED" && prevRank > 0 && newRank < prevRank) {
            return;
        }

        // 2. Dedup: Has this order status ALREADY been announced?
        const announceKey = `${orderId}:${newStatus}`;
        if (announcedStatusKeysRef.current.has(announceKey)) {
            // Still ensure lastOrderStatusMapRef has the latest monotonic status
            lastOrderStatusMapRef.current[orderId] = newStatus;
            return;
        }

        // 3. Update tracking immediately before any state mutation or speech
        lastOrderStatusMapRef.current[orderId] = newStatus;
        announcedStatusKeysRef.current.add(announceKey);

        // Also mark all previous statuses as announced so an old status packet can never fire
        Object.keys(STATUS_RANK).forEach((st) => {
            if ((STATUS_RANK[st] || 0) <= newRank) {
                announcedStatusKeysRef.current.add(`${orderId}:${st}`);
            }
        });

        // 4. Only announce transitions into ACCEPTED, PREPARING, READY, SERVED, CANCELLED
        const statusLabels: Record<string, { text: string; voice: string }> = {
            ACCEPTED: {
                text: `✅ *Kitchen Update*: Your order *#${orderNumber}* has been *ACCEPTED* by the kitchen!`,
                voice: `Good news! The kitchen has accepted your order number ${orderNumber}.`,
            },
            PREPARING: {
                text: `👨‍🍳 *Kitchen Update*: Our chef is now freshly *PREPARING* your order *#${orderNumber}*!`,
                voice: `Our chef is now preparing your order number ${orderNumber}.`,
            },
            READY: {
                text: `🔔 *Hot & Ready!*: Your order *#${orderNumber}* is *READY* to be served to your table!`,
                voice: `Your order number ${orderNumber} is hot and ready to be served!`,
            },
            SERVED: {
                text: `🍽️ *Order Served*: Your order *#${orderNumber}* has been *SERVED*. Enjoy your meal! 😋`,
                voice: `Order number ${orderNumber} has been served. Enjoy your meal!`,
            },
            CANCELLED: {
                text: `⚠️ *Order Update*: Your order *#${orderNumber}* was cancelled.`,
                voice: `Order number ${orderNumber} has been cancelled.`,
            },
        };
        const info = statusLabels[newStatus];
        if (info) {
            appendBotMessage(info.text, [{ id: "order_status", title: "👨‍🍳 Check Order Status" }], true, info.voice);
        }
    }

    async function refreshSessionState(sessId?: string, forceCartOverwrite = false) {
        const id = sessId || sessionData?.session?.id;
        if (!id) return;
        const requestStartedAt = Date.now();
        try {
            const res = await api.get(`/kiosk/session/${id}?light=true`);
            // If backend reports this session is CLOSED or PAID, trigger clean session refresh immediately
            if (res.data?.session?.status === "CLOSED" || res.data?.bill?.status === "PAID") {
                startOrResumeSession(activeToken, selectedTableId, true);
                return;
            }
            const incomingOrders: Order[] = res.data?.orders || [];
            incomingOrders.forEach((o) => {
                if (!o?.id || !o?.status) return;
                const existingStatus = lastOrderStatusMapRef.current[o.id];
                if (!existingStatus) {
                    seedOrderStatuses([o]);
                } else if (existingStatus !== o.status) {
                    announceOrderStatusIfNeeded(o.id, o.order_number, o.status);
                }
            });
            setSessionData((prev: any) => {
                if (!prev) return res.data;
                // If a cart add/update/remove is currently in flight (or finished after this GET started),
                // keep the local optimistic cart so the item NEVER flickers or reappears!
                const cartBusy =
                    !forceCartOverwrite &&
                    (cartMutationCountRef.current > 0 || lastCartMutationTimeRef.current > requestStartedAt);
                return {
                    ...prev,
                    ...res.data,
                    restaurant: res.data.restaurant || prev.restaurant,
                    branch: res.data.branch || prev.branch,
                    categories: res.data.categories || prev.categories,
                    menu_items: res.data.menu_items || prev.menu_items,
                    cart: cartBusy ? prev.cart : res.data.cart,
                };
            });
        } catch {
            // ignore
        }
    }

    // Connect Table WebSocket for live Kitchen status updates & Cashier payment events
    useEffect(() => {
        const sessionId = sessionData?.session?.id;
        if (!sessionId) return;

        // Seed initial order statuses for this session
        if (sessionData?.orders) {
            seedOrderStatuses(sessionData.orders);
        }

        const ws = new WebSocket(`${WS_BASE_URL}/orders/ws/table/${sessionId}`);

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.event === "ORDER_STATUS_UPDATED") {
                    if (data.order_id && data.status) {
                        announceOrderStatusIfNeeded(data.order_id, data.order_number, data.status);
                    }
                    refreshSessionState(sessionId);
                } else if (data.event === "SESSION_PAID_AND_EXPIRED") {
                    triggerGoodbyeFlow(
                        data.bill_number || "PAID",
                        Number(data.amount || 0),
                        0,
                        0,
                        0,
                        data.message || "Thank you for dining with us! Your payment is complete."
                    );
                }
            } catch {
                // ignore
            }
        };

        const poll = setInterval(() => refreshSessionState(sessionId), 6000);
        return () => {
            ws.close();
            clearInterval(poll);
        };
    }, [sessionData?.session?.id]);

    // Countdown timer for Goodbye screen -> forces a brand new session for the next customer
    useEffect(() => {
        if (!goodbyeScreen) return;
        if (goodbyeScreen.countdown <= 0) {
            startOrResumeSession(activeToken, selectedTableId, true);
            return;
        }
        const timer = setTimeout(() => {
            setGoodbyeScreen((prev) => (prev ? { ...prev, countdown: prev.countdown - 1 } : null));
        }, 1000);
        return () => clearTimeout(timer);
    }, [goodbyeScreen]);

    // Safety guard: A closed/paid session must NEVER linger on a table kiosk
    useEffect(() => {
        if (
            sessionData &&
            (sessionData.session?.status === "CLOSED" || sessionData.bill?.status === "PAID") &&
            !goodbyeScreen
        ) {
            startOrResumeSession(activeToken, selectedTableId, true);
        }
    }, [sessionData?.session?.status, sessionData?.bill?.status, goodbyeScreen]);

    function triggerGoodbyeFlow(
        billNumber: string,
        amountPaid: number,
        subtotal: number,
        cgst: number,
        sgst: number,
        goodbyeMsg: string
    ) {
        setShowBillModal(false);
        setShowOrderConfirmModal(false);
        setShowCartRemoveModal(false);
        // Immediately clear check-in session storage & customer name so previous guest name NEVER leaks to next customer
        sessionStorage.removeItem("hd_kiosk_checkedin_session");
        setCheckedInSessionId("");
        setWelcomeName("");
        setWelcomeDob("");
        setWelcomeIsBirthday(false);

        // Immediately clear session.id, orders, customer & cart in local state so background polling stops and old GST buttons never show
        setSessionData((prev: any) =>
            prev
                ? {
                      ...prev,
                      session: { ...prev.session, id: null, status: "CLOSED" },
                      customer: { id: null, name: `Table ${prev.table?.table_number || ""} Guest` },
                      orders: [],
                      cart: { id: null, subtotal: 0, cgst_amount: 0, sgst_amount: 0, total: 0, items: [] },
                      bill: { status: "PAID" },
                  }
                : null
        );
        speakText(`Payment of Rupees ${amountPaid.toFixed(0)} received. Thank you for dining with us! Have a wonderful day!`);
        setGoodbyeScreen({
            bill_number: billNumber,
            amount_paid: amountPaid,
            subtotal,
            cgst,
            sgst,
            message: goodbyeMsg,
            countdown: 10,
        });
    }

    function launchBirthdayCelebration(name: string, wish: string, restName?: string) {
        if (stopMusicRef.current) stopMusicRef.current();
        stopMusicRef.current = playHappyBirthdayMelody();

        const cleanName = name || "Special Guest";
        const restaurantTitle = restName || sessionData?.restaurant?.name || "HelloDine";
        const fullWish =
            wish ||
            `Happy Birthday, ${cleanName}! Wishing you a magical day filled with joy, laughter, and delicious food at ${restaurantTitle}!`;

        setBirthdayOverlay({
            name: cleanName,
            wish: fullWish,
            restaurant_name: restaurantTitle,
        });
        speakText(`Happy Birthday to you, ${cleanName}! Wishing you a wonderful celebration at ${restaurantTitle}!`);
    }

    async function handleCustomerCheckinSubmit(e: React.FormEvent) {
        e.preventDefault();
        const sessId = sessionData?.session?.id;
        if (!sessId) return;
        const cleanName = welcomeName.trim() || `Table T${sessionData?.table?.table_number} Guest`;
        setCheckingIn(true);
        try {
            const res = await api.post(`/kiosk/session/${sessId}/checkin`, {
                customer_name: cleanName,
                customer_dob: welcomeDob || null,
                is_birthday_today: welcomeIsBirthday,
            });
            if (res.data?.state) {
                setSessionData(res.data.state);
                if (res.data.state.orders) {
                    seedOrderStatuses(res.data.state.orders);
                }
            }
            sessionStorage.setItem("hd_kiosk_checkedin_session", sessId);
            setCheckedInSessionId(sessId);

            const restName = sessionData?.restaurant?.name || "HelloDine";
            const tableNum = sessionData?.table?.table_number || "";
            setMessages([
                {
                    id: `welcome-${Date.now()}`,
                    sender: "bot",
                    text: `Welcome *${cleanName}* to *${restName}* (Table T${tableNum})! 😊🍽️\n\n• Tap dishes on the left menu for instant adding to cart.\n• Or chat / tap 🎤 here to ask me for Top 3 Best Dishes, order by voice, or check your GST bill!`,
                    buttons: [
                        { id: "recommend_best", title: "⭐ Top 3 Best Dishes" },
                        { id: "tell_joke", title: "😂 Hear a Joke" },
                        { id: "show_cartoons", title: "🎬 Kids Cartoons" },
                    ],
                    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                },
            ]);

            if (res.data?.is_birthday_today || welcomeIsBirthday) {
                setTimeout(() => {
                    launchBirthdayCelebration(
                        cleanName,
                        `Happy Birthday, ${cleanName}! 🎂🥳 Everyone at ${restName} wishes you a magical celebration filled with joy, laughter, and delicious food today!`,
                        restName
                    );
                }, 300);
            }
        } catch {
            // Even if network hiccups, let customer into ordering screen
            sessionStorage.setItem("hd_kiosk_checkedin_session", sessId);
            setCheckedInSessionId(sessId);
        } finally {
            setCheckingIn(false);
        }
    }

    // ─── RIGHT SIDE: AI CHAT & VOICE BOT HANDLER ───────────────────────────────
    // shouldSpeak is true ONLY when the user chats/speaks with the right-side AI bot
    async function sendChatMessage(textToSend?: string, displayLabel?: string, shouldSpeakReply = true) {
        const messageText = (textToSend ?? chatInput).trim();
        if (!messageText || !sessionData?.session?.id) return;

        // Normalize text (lowercase, strip trailing and surrounding punctuation/whitespace)
        // so "Confirm order.", "Confirm order", "confirm order" are identical to duplicate checks
        const normKey = messageText.toLowerCase().replace(/[.,!?'"~`\s]+/g, " ").trim();
        const now = Date.now();

        // Debounce / duplicate submission lock: ignore if another call is currently in-flight
        // or if the exact same message was submitted within the last 3000ms
        if (chatInFlightRef.current) return;
        if (
            lastChatSubmissionNormRef.current === normKey &&
            now - lastChatSubmissionTimeRef.current < 3000
        ) {
            return;
        }

        // Lock in-flight chat calls
        chatInFlightRef.current = true;
        lastChatSubmissionTimeRef.current = now;
        lastChatSubmissionNormRef.current = normKey;

        // Clear any lingering voice silence timers to prevent voice onresult timeout from firing a second call
        if (voiceWaitTimerRef.current) {
            clearTimeout(voiceWaitTimerRef.current);
            voiceWaitTimerRef.current = null;
        }
        // Stop and unbind speech recognition so it can't deliver more results for this turn
        if (recognitionRef.current) {
            try {
                recognitionRef.current.onresult = null;
                recognitionRef.current.onend = null;
                recognitionRef.current.onerror = null;
                recognitionRef.current.abort();
            } catch {}
            recognitionRef.current = null;
        }
        setIsListening(false);
        setVoiceTranscriptNotice("");

        // Instant Fast Path for Order Confirmation: 0ms delay directly triggers kitchen dispatch
        const norm = messageText.toLowerCase();
        if (norm === "do_confirm" || norm === "confirm_order" || norm === "confirm order" || norm === "confirm") {
            try {
                await handleConfirmSendToKitchen();
            } finally {
                chatInFlightRef.current = false;
            }
            return;
        }

        const userDisplay = displayLabel || messageText;
        setMessages((prev) => [
            ...prev,
            {
                id: `user-${Date.now()}`,
                sender: "user",
                text: userDisplay,
                time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
        ]);
        if (!textToSend) setChatInput("");
        setBotThinking(true);

        try {
            const chatStartedAt = Date.now();
            const res = await api.post("/kiosk/chat", {
                session_id: sessionData.session.id,
                message: messageText,
            });

            if (res.data.state) {
                setSessionData((prev: any) => {
                    if (!prev) return res.data.state;
                    const cartBusy =
                        cartMutationCountRef.current > 0 || lastCartMutationTimeRef.current > chatStartedAt;
                    return {
                        ...prev,
                        ...res.data.state,
                        restaurant: res.data.state.restaurant || prev.restaurant,
                        branch: res.data.state.branch || prev.branch,
                        categories: res.data.state.categories || prev.categories,
                        menu_items: res.data.state.menu_items || prev.menu_items,
                        cart: cartBusy ? prev.cart : res.data.state.cart,
                    };
                });
            }

            const reply = res.data.reply;
            const uiAction = res.data.ui_action;

            // Requirement 9: If showing bill/invoice, do NOT read all line items aloud — only speak short prompt
            let voiceOverride: string | undefined = reply?.voice_text;
            if (uiAction?.action === "SHOW_BILL") {
                voiceOverride = "Please review your invoice details on the screen and scan the QR code for payment.";
            }

            if (reply?.body) {
                appendBotMessage(reply.body, reply.buttons, shouldSpeakReply, voiceOverride);
            }

            if (uiAction?.action === "SHOW_CARTOONS") {
                setShowCartoonModal(true);
            } else if (uiAction?.action === "SHOW_JOKE" && uiAction.joke) {
                setJokeBanner(uiAction.joke);
            } else if (uiAction?.action === "SHOW_BIRTHDAY") {
                launchBirthdayCelebration(uiAction.name, uiAction.wish, uiAction.restaurant_name);
            } else if (uiAction?.action === "SHOW_BILL") {
                setShowBillModal(true);
            } else if (uiAction?.action === "FILTER_MENU") {
                setBestsellerOnly(false);
                setSelectedCategory(uiAction.category_id || "ALL");
                setVegFilter(uiAction.veg_filter || "ALL");
                setSearchQuery(uiAction.search_query || "");
                if (Array.isArray(uiAction.matched_item_ids) && uiAction.matched_item_ids.length > 0) {
                    setAiMatchedItemIds(uiAction.matched_item_ids);
                } else {
                    setAiMatchedItemIds(null);
                }
            }
        } catch (err: any) {
            appendBotMessage(
                err.response?.data?.detail || "Sorry, I couldn't process that right now. Please try again.",
                undefined,
                false
            );
        } finally {
            setBotThinking(false);
            chatInFlightRef.current = false;
        }
    }

    // Voice Recognition (Web Speech API) — Optimised for Android Tablets & Desktop
    function toggleVoiceInput() {
        // 1. Instantly unlock Android/Mobile AudioContext & SpeechSynthesis on direct tap
        unlockMobileAudio();

        const SpeechRecognition =
            (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Voice recognition is supported in Chrome, Edge, and Safari browsers.");
            return;
        }

        // Helper to cleanly terminate and detach the active speech recognition instance
        const cleanupRecognition = () => {
            if (voiceWaitTimerRef.current) {
                clearTimeout(voiceWaitTimerRef.current);
                voiceWaitTimerRef.current = null;
            }
            if (recognitionRef.current) {
                try {
                    recognitionRef.current.onresult = null;
                    recognitionRef.current.onend = null;
                    recognitionRef.current.onerror = null;
                    recognitionRef.current.abort();
                } catch {}
                recognitionRef.current = null;
            }
            setIsListening(false);
            setVoiceTranscriptNotice("");
        };

        // If already listening, customer tapped "Done / Send" — immediately dispatch what was spoken!
        if (isListening && recognitionRef.current) {
            const captured = voiceAccumulatedRef.current.trim();
            voiceAccumulatedRef.current = "";
            cleanupRecognition();
            setChatInput("");

            if (captured.length >= 2 && !voiceDispatchedForSessionRef.current) {
                voiceDispatchedForSessionRef.current = true;
                sendChatMessage(captured, `🎤 "${captured}"`, true);
            }
            return;
        }

        // Starting a new voice session
        cleanupRecognition();
        voiceAccumulatedRef.current = "";
        voiceDispatchedForSessionRef.current = false;

        const recognition = new SpeechRecognition();
        recognition.lang = "en-IN";
        // On Android / mobile, continuous=true causes multiple competing isFinal events.
        // We set continuous = false for mobile/touch devices for rock-solid stability.
        const isMobileDevice =
            typeof navigator !== "undefined" &&
            (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1);
        recognition.continuous = !isMobileDevice;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            setIsListening(true);
            setVoiceTranscriptNotice("🎤 Listening… Speak now! (Tap ⏹️ or wait 2.5s when done)");
        };

        recognition.onend = () => {
            setIsListening(false);
            // On mobile devices where continuous=false, engine naturally stops when user pauses.
            // If text was captured and hasn't been sent yet, dispatch it now!
            const captured = voiceAccumulatedRef.current.trim();
            if (captured && !voiceDispatchedForSessionRef.current) {
                voiceAccumulatedRef.current = "";
                cleanupRecognition();
                setChatInput("");
                voiceDispatchedForSessionRef.current = true;
                sendChatMessage(captured, `🎤 "${captured}"`, true);
            }
        };

        recognition.onerror = (e: any) => {
            setIsListening(false);
            if (!voiceAccumulatedRef.current.trim()) {
                const errType = e?.error;
                if (errType === "not-allowed" || errType === "service-not-allowed") {
                    setVoiceTranscriptNotice("⚠️ Microphone access blocked. Please allow mic permission in browser settings.");
                } else if (errType !== "no-speech" && errType !== "aborted") {
                    setVoiceTranscriptNotice("⚠️ Could not hear clearly. Please tap 🎤 again or type below.");
                }
            }
        };

        recognition.onresult = (event: any) => {
            // If already dispatched, ignore any subsequent speech events from the engine
            if (voiceDispatchedForSessionRef.current) return;

            let fullTranscript = "";
            let lowestConfidence = 1.0;

            for (let i = 0; i < event.results.length; i++) {
                const res = event.results[i];
                fullTranscript += res[0].transcript + " ";
                if (res.isFinal && typeof res[0].confidence === "number" && res[0].confidence > 0) {
                    lowestConfidence = Math.min(lowestConfidence, res[0].confidence);
                }
            }

            const cleaned = fullTranscript.trim();
            if (cleaned) {
                voiceAccumulatedRef.current = cleaned;
                setVoiceTranscriptNotice(`🎤 Listening: "${cleaned}"… (Tap ⏹️ or pause to send)`);
            }

            // Reset the 2.5-second silence timer every time the user speaks a word
            if (voiceWaitTimerRef.current) {
                clearTimeout(voiceWaitTimerRef.current);
            }

            voiceWaitTimerRef.current = setTimeout(() => {
                if (voiceDispatchedForSessionRef.current) return;

                const finalSpoken = voiceAccumulatedRef.current.trim();
                voiceAccumulatedRef.current = "";
                cleanupRecognition();

                if (!finalSpoken) return;

                if (finalSpoken.length < 2 || lowestConfidence < 0.5) {
                    setChatInput(finalSpoken);
                    setVoiceTranscriptNotice(
                        `🎤 Heard: "${finalSpoken}" — Please check & tap Send (or edit if unclear)`
                    );
                } else {
                    voiceDispatchedForSessionRef.current = true;
                    setChatInput("");
                    sendChatMessage(finalSpoken, `🎤 "${finalSpoken}"`, true);
                }
            }, 2500);
        };

        recognitionRef.current = recognition;
        try {
            recognition.start();
        } catch {
            setIsListening(false);
        }
    }

    // ─── LEFT SIDE: INSTANT OPTIMISTIC CART UPDATES (No AI delay, No Voice) ───
    function recalculateOptimisticCart(items: CartItem[]) {
        let subtotal = 0;
        let cgst = 0;
        let sgst = 0;
        items.forEach((ci) => {
            const line = ci.unit_price * ci.quantity;
            ci.line_total = line;
            const halfGst = (ci.gst_percent || 5) / 200;
            subtotal += line;
            cgst += line * halfGst;
            sgst += line * halfGst;
        });
        const total = Math.round((subtotal + cgst + sgst) * 100) / 100;
        return {
            ...sessionData.cart,
            items,
            subtotal: Math.round(subtotal * 100) / 100,
            cgst_amount: Math.round(cgst * 100) / 100,
            sgst_amount: Math.round(sgst * 100) / 100,
            total,
        };
    }

    async function handleAddItem(item: MenuItem) {
        if (!sessionData?.session?.id) return;

        cartMutationCountRef.current += 1;
        lastCartMutationTimeRef.current = Date.now();

        // 1. Instant Optimistic UI Update (< 1ms) using functional state so rapid taps never lose items
        setSessionData((prev: any) => {
            if (!prev) return prev;
            const currentItems: CartItem[] = [...(prev.cart?.items || [])];
            const existingIdx = currentItems.findIndex((x) => x.menu_item_id === item.id);
            if (existingIdx >= 0) {
                currentItems[existingIdx] = {
                    ...currentItems[existingIdx],
                    quantity: currentItems[existingIdx].quantity + 1,
                };
            } else {
                currentItems.push({
                    id: `temp-${item.id}`,
                    menu_item_id: item.id,
                    name: item.name,
                    is_veg: item.is_veg,
                    gst_percent: item.gst_percent,
                    quantity: 1,
                    unit_price: item.base_price,
                    line_total: item.base_price,
                });
            }
            return {
                ...prev,
                cart: recalculateOptimisticCart(currentItems),
            };
        });

        // 2. Sync to DB in background — /api/cart/add now returns the full updated cart directly (no 2nd GET call!)
        try {
            const res = await api.post("/cart/add", {
                session_id: sessionData.session.id,
                menu_item_id: item.id,
                quantity: 1,
            });
            lastCartMutationTimeRef.current = Date.now();
            if (res.data?.cart && cartMutationCountRef.current <= 1) {
                setSessionData((prev: any) => (prev ? { ...prev, cart: res.data.cart } : prev));
            }
        } catch {
            refreshSessionState(undefined, true);
        } finally {
            cartMutationCountRef.current = Math.max(0, cartMutationCountRef.current - 1);
        }
    }

    async function handleUpdateCartQty(cartItem: CartItem, newQty: number) {
        if (!sessionData?.session?.id) return;

        cartMutationCountRef.current += 1;
        lastCartMutationTimeRef.current = Date.now();

        // 1. Instant Optimistic UI Update (< 1ms) using functional state
        setSessionData((prev: any) => {
            if (!prev) return prev;
            let currentItems: CartItem[] = [...(prev.cart?.items || [])];
            if (newQty <= 0) {
                currentItems = currentItems.filter((x) => x.menu_item_id !== cartItem.menu_item_id);
            } else {
                currentItems = currentItems.map((x) =>
                    x.menu_item_id === cartItem.menu_item_id ? { ...x, quantity: newQty } : x
                );
            }
            return {
                ...prev,
                cart: recalculateOptimisticCart(currentItems),
            };
        });

        // 2. Sync to DB in background
        try {
            if (String(cartItem.id).startsWith("temp-")) {
                // If user tapped +/- while initial /cart/add was still saving, use /cart/add with delta
                const delta = newQty - cartItem.quantity;
                if (delta > 0) {
                    const res = await api.post("/cart/add", {
                        session_id: sessionData.session.id,
                        menu_item_id: cartItem.menu_item_id,
                        quantity: delta,
                    });
                    if (res.data?.cart && cartMutationCountRef.current <= 1) {
                        setSessionData((prev: any) => (prev ? { ...prev, cart: res.data.cart } : prev));
                    }
                } else {
                    await refreshSessionState(undefined, true);
                }
                return;
            }
            let res;
            if (newQty <= 0) {
                res = await api.delete(`/cart/item/${cartItem.id}`);
            } else {
                res = await api.patch(`/cart/item/${cartItem.id}/quantity`, { quantity: newQty });
            }
            lastCartMutationTimeRef.current = Date.now();
            if (res.data?.cart && cartMutationCountRef.current <= 1) {
                setSessionData((prev: any) => (prev ? { ...prev, cart: res.data.cart } : prev));
            }
        } catch {
            refreshSessionState(undefined, true);
        } finally {
            cartMutationCountRef.current = Math.max(0, cartMutationCountRef.current - 1);
        }
    }

    // Remove a single item completely from the cart with zero flicker
    async function handleRemoveCartItemCompletely(cartItem: CartItem) {
        if (!sessionData?.session?.id) return;

        cartMutationCountRef.current += 1;
        lastCartMutationTimeRef.current = Date.now();

        setSessionData((prev: any) => {
            if (!prev) return prev;
            const currentItems: CartItem[] = (prev.cart?.items || []).filter(
                (x: CartItem) => x.menu_item_id !== cartItem.menu_item_id
            );
            if (currentItems.length === 0) {
                setShowCartRemoveModal(false);
            }
            return {
                ...prev,
                cart: recalculateOptimisticCart(currentItems),
            };
        });

        try {
            if (!String(cartItem.id).startsWith("temp-")) {
                const res = await api.delete(`/cart/item/${cartItem.id}`);
                lastCartMutationTimeRef.current = Date.now();
                if (res.data?.cart && cartMutationCountRef.current <= 1) {
                    setSessionData((prev: any) => (prev ? { ...prev, cart: res.data.cart } : prev));
                }
            } else {
                await refreshSessionState(undefined, true);
            }
        } catch {
            refreshSessionState(undefined, true);
        } finally {
            cartMutationCountRef.current = Math.max(0, cartMutationCountRef.current - 1);
        }
    }

    // Clear all items in the cart atomically in 1 backend SQL DELETE with zero flicker
    async function handleClearAllCartItems() {
        if (!sessionData?.session?.id) return;

        cartMutationCountRef.current += 1;
        lastCartMutationTimeRef.current = Date.now();
        setShowCartRemoveModal(false);

        setSessionData((prev: any) =>
            prev
                ? {
                      ...prev,
                      cart: { id: prev.cart?.id || null, subtotal: 0, cgst_amount: 0, sgst_amount: 0, total: 0, items: [] },
                  }
                : prev
        );

        try {
            const res = await api.delete(`/cart/${sessionData.session.id}/clear`);
            lastCartMutationTimeRef.current = Date.now();
            if (res.data?.cart && cartMutationCountRef.current <= 1) {
                setSessionData((prev: any) => (prev ? { ...prev, cart: res.data.cart } : prev));
            }
        } catch {
            refreshSessionState(undefined, true);
        } finally {
            cartMutationCountRef.current = Math.max(0, cartMutationCountRef.current - 1);
        }
    }

    // Requirement 8: Clicking "Place Order to Kitchen" on Left Side opens Order Summary & AI speaks for confirmation
    function handleInitiatePlaceOrder() {
        const items: CartItem[] = sessionData?.cart?.items || [];
        if (items.length === 0) return;
        setShowOrderConfirmModal(true);
        const itemSummary = items.map((i) => `${i.quantity} ${i.name}`).join(", ");
        speakText(
            `You have selected ${itemSummary}. Total is Rupees ${Number(sessionData.cart.total).toFixed(
                0
            )}. Please confirm to send your order to the kitchen.`
        );
    }

    // Confirming order sends directly to `/api/orders/place` and awaits the real server confirmation
    async function handleConfirmSendToKitchen() {
        if (!sessionData?.session?.id) return;
        const currentCart = sessionData.cart;
        if (!currentCart || !currentCart.items || currentCart.items.length === 0) {
            alert("Your cart is empty. Please add items before placing an order.");
            return;
        }

        setPlacingOrder(true);
        try {
            const res = await api.post("/orders/place", {
                session_id: sessionData.session.id,
            });

            // Update session data directly from backend response (no extra GET request needed!)
            if (res.data.state) {
                setSessionData((prev: any) => ({
                    ...prev,
                    ...res.data.state,
                    restaurant: res.data.state.restaurant || prev?.restaurant,
                    branch: res.data.state.branch || prev?.branch,
                    categories: res.data.state.categories || prev?.categories,
                    menu_items: res.data.state.menu_items || prev?.menu_items,
                }));
            }

            // Immediately track the newly created order at status NEW so subsequent status updates (ACCEPTED, etc.)
            // trigger cleanly without ever repeating or being treated as an unknown order
            if (res.data?.order_id) {
                lastOrderStatusMapRef.current[res.data.order_id] = "NEW";
                announcedStatusKeysRef.current.add(`${res.data.order_id}:NEW`);
            }
            if (res.data?.state?.orders) {
                seedOrderStatuses(res.data.state.orders);
            }

            // Close confirmation modal
            setShowOrderConfirmModal(false);

            const orderNum = res.data.order_number;
            appendBotMessage(
                `✅ *Order #${orderNum} Confirmed & Sent to Kitchen!*\n\n👨‍🍳 Our chef has received your ticket. While your food is being prepared, enjoy a joke, kids cartoons, or celebrate a birthday!`,
                [
                    { id: "tell_joke", title: "😂 Hear a Joke" },
                    { id: "show_cartoons", title: "🎬 Kids Cartoons" },
                ],
                true,
                `Order ${orderNum} is confirmed and sent to the kitchen!`
            );
        } catch (err: any) {
            alert(err.response?.data?.detail || "Could not place order. Please try again.");
        } finally {
            setPlacingOrder(false);
        }
    }

    // Requirement 6 & 9: Left-side button opens GST Bill & QR modal directly, and AI only speaks a short prompt
    function handleOpenBillModalDirect() {
        setShowBillModal(true);
        speakText("Please review your invoice details on the screen and scan the QR code for payment.");
    }

    // Requirement 10: Complete payment with accurate Grand Total and clean session refresh
    async function handlePayViaTableQR(expectedGrandTotal: number, expectedSub: number, expectedCgst: number, expectedSgst: number) {
        if (!sessionData?.session?.id) return;
        setPayingQR(true);
        try {
            const res = await api.post(`/kiosk/session/${sessionData.session.id}/pay-qr`, {
                upi_reference_id: upiRefInput.trim() || undefined,
                upi_vpa: sessionData.restaurant?.upi_id || import.meta.env.VITE_MERCHANT_UPI_ID || "hellodine@ybl",
            });
            const finalPaid = Number(res.data.amount_paid || expectedGrandTotal);
            triggerGoodbyeFlow(
                res.data.bill_number,
                finalPaid,
                Number(res.data.subtotal || expectedSub),
                Number(res.data.cgst_amount || expectedCgst),
                Number(res.data.sgst_amount || expectedSgst),
                res.data.goodbye_message
            );
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to process payment");
        } finally {
            setPayingQR(false);
        }
    }

    // ─── 1. GOODBYE & SESSION EXPIRED SCREEN (Requirement 10) ──────────────────
    if (goodbyeScreen) {
        return (
            <div
                style={{
                    minHeight: "100vh",
                    background: "radial-gradient(circle at center, rgba(35,209,139,0.25) 0%, #0b0d17 70%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 24,
                }}
            >
                <div
                    className="card"
                    style={{
                        maxWidth: 580,
                        width: "100%",
                        textAlign: "center",
                        padding: "44px 36px",
                        border: "2px solid var(--green)",
                        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
                    }}
                >
                    <div style={{ fontSize: "4rem", marginBottom: 10 }}>✅🎉🙏</div>
                    <h1 style={{ fontSize: "2.1rem", fontWeight: 900, color: "var(--green)", marginBottom: 6 }}>
                        Payment Successful!
                    </h1>
                    <div className="text-muted text-sm" style={{ marginBottom: 16 }}>
                        Invoice #{goodbyeScreen.bill_number} · Notified Cashier Live
                    </div>

                    {/* Clear Total Paid Box */}
                    <div
                        style={{
                            background: "rgba(35,209,139,0.1)",
                            border: "1px solid var(--green)",
                            borderRadius: 14,
                            padding: "18px 22px",
                            marginBottom: 20,
                        }}
                    >
                        <div className="text-sm text-muted">Total Amount Paid (incl. GST)</div>
                        <div style={{ fontSize: "2.5rem", fontWeight: 900, color: "var(--green)", margin: "4px 0" }}>
                            ₹{goodbyeScreen.amount_paid.toFixed(2)}
                        </div>
                        {goodbyeScreen.subtotal > 0 && (
                            <div className="text-sm text-muted">
                                Subtotal: ₹{goodbyeScreen.subtotal.toFixed(2)} · CGST: ₹{goodbyeScreen.cgst.toFixed(2)} · SGST: ₹{goodbyeScreen.sgst.toFixed(2)}
                            </div>
                        )}
                    </div>

                    <p style={{ fontSize: "1.05rem", lineHeight: 1.6, color: "var(--text)", marginBottom: 22 }}>
                        {goodbyeScreen.message}
                    </p>

                    <div
                        style={{
                            background: "rgba(255,255,255,0.04)",
                            padding: "12px 18px",
                            borderRadius: 10,
                            border: "1px solid var(--border)",
                            marginBottom: 22,
                            fontSize: "0.88rem",
                            color: "var(--text-muted)",
                        }}
                    >
                        🔒 Table session closed. Starting fresh session for the next customer in{" "}
                        <strong style={{ color: "var(--orange)" }}>{goodbyeScreen.countdown}s</strong>…
                    </div>

                    <button
                        className="btn btn-primary"
                        style={{ width: "100%", justifyContent: "center", padding: "14px", fontSize: "1rem" }}
                        onClick={() => startOrResumeSession(activeToken, selectedTableId, true)}
                    >
                        🍽️ Start Fresh Session Now
                    </button>
                </div>
            </div>
        );
    }

    // ─── 2. TABLE BINDING SCREEN ──────────────────────────────────────────────
    if (!activeToken && !selectedTableId && !loading) {
        return (
            <div className="login-wrap" style={{ padding: 24 }}>
                <div className="card" style={{ maxWidth: 640, width: "100%", padding: 32 }}>
                    <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
                        <h1 style={{ fontSize: "1.8rem", fontWeight: 800, color: "var(--accent)" }}>
                            📱 Bind Tablet to Restaurant Table
                        </h1>
                        <button className="btn btn-outline btn-sm" onClick={loadAvailableTables}>
                            🔄 Retry / Refresh
                        </button>
                    </div>
                    <p className="text-muted" style={{ marginBottom: 24 }}>
                        Select which table this tablet device is placed on to launch the Smart Table Ordering & AI Assistant UI:
                    </p>
                    {error ? (
                        <div style={{ padding: 16, borderRadius: 10, background: "rgba(255,95,87,0.12)", border: "1px solid var(--red)", color: "var(--red)", marginBottom: 16 }}>
                            ⚠️ {error}
                        </div>
                    ) : availableBranches.length === 0 ? (
                        <p className="text-muted">No active tables found. Please create a branch and table in Admin first.</p>
                    ) : (
                        availableBranches.map((b) => (
                            <div key={b.branch_id} style={{ marginBottom: 24 }}>
                                <h3 style={{ fontSize: "1.05rem", marginBottom: 10 }}>
                                    🏢 {b.restaurant_name} — <span style={{ color: "var(--accent)" }}>{b.branch_name}</span>
                                </h3>
                                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                    {b.tables.map((t: any) => (
                                        <button
                                            key={t.id}
                                            className="btn btn-primary"
                                            onClick={() => setSelectedTableId(t.id)}
                                        >
                                            🪑 Table T{t.table_number}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="login-wrap">
                <div className="card" style={{ textAlign: "center", padding: 40 }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>🍽️🤖</div>
                    <h2>Starting Smart Table Kiosk…</h2>
                    <p className="text-muted mt-2">Loading Menu & AI Assistant</p>
                </div>
            </div>
        );
    }

    if (error || !sessionData) {
        return (
            <div className="login-wrap">
                <div className="card" style={{ textAlign: "center", padding: 40, maxWidth: 460 }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>⚠️</div>
                    <h2>Table Setup Required</h2>
                    <p className="text-muted mt-2" style={{ marginBottom: 20 }}>{error}</p>
                    <button
                        className="btn btn-primary"
                        onClick={() => {
                            localStorage.removeItem("hd_kiosk_token");
                            localStorage.removeItem("hd_kiosk_table_id");
                            setActiveToken("");
                            setSelectedTableId("");
                        }}
                    >
                        Choose Another Table
                    </button>
                </div>
            </div>
        );
    }

    const categories: MenuCategory[] = sessionData.categories || [];
    const menuItems: MenuItem[] = sessionData.menu_items || [];
    const isSessionPaidOrClosed =
        sessionData.session?.status === "CLOSED" || sessionData.bill?.status === "PAID";
    const cart = isSessionPaidOrClosed
        ? { items: [], subtotal: 0, cgst_amount: 0, sgst_amount: 0, total: 0 }
        : sessionData.cart || { items: [], subtotal: 0, cgst_amount: 0, sgst_amount: 0, total: 0 };
    const orders: Order[] = isSessionPaidOrClosed ? [] : sessionData.orders || [];
    const activeOrders = orders.filter((o) => o.status !== "CANCELLED");
    // Customer can ONLY cancel an order if there is a NEW or ACCEPTED order (and not once it is PREPARING, READY, or SERVED)
    const hasCancellableOrder = activeOrders.some(
        (o) => o.status === "NEW" || o.status === "ACCEPTED"
    );

    const ordersSubtotal = Math.round(activeOrders.reduce((s, o) => s + Number(o.subtotal), 0) * 100) / 100;
    const ordersCgst = Math.round(activeOrders.reduce((s, o) => s + Number(o.cgst_amount), 0) * 100) / 100;
    const ordersSgst = Math.round(activeOrders.reduce((s, o) => s + Number(o.sgst_amount), 0) * 100) / 100;
    const ordersGrandTotal = Math.round(activeOrders.reduce((s, o) => s + Number(o.total), 0) * 100) / 100;

    const categoryNameMap: Record<string, string> = {};
    categories.forEach((c) => {
        categoryNameMap[c.id] = c.name.toLowerCase();
    });

    const hasAnyBestsellerFlag = menuItems.some((m) => m.is_bestseller);
    const topFallbackIds = new Set(menuItems.slice(0, 6).map((m) => m.id));

    const filteredItems = menuItems.filter((item) => {
        if (aiMatchedItemIds && aiMatchedItemIds.length > 0) {
            return aiMatchedItemIds.includes(item.id);
        }
        if (bestsellerOnly) {
            const isBest = hasAnyBestsellerFlag ? Boolean(item.is_bestseller) : topFallbackIds.has(item.id);
            if (!isBest) return false;
        }
        if (selectedCategory !== "ALL" && item.category_id !== selectedCategory) return false;
        if (vegFilter === "VEG" && !item.is_veg) return false;
        if (vegFilter === "NONVEG" && item.is_veg) return false;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            const catName = categoryNameMap[item.category_id] || "";
            if (!item.name.toLowerCase().includes(q) && !catName.includes(q)) return false;
        }
        return true;
    });

    const cartQtyMap: Record<string, CartItem> = {};
    (cart.items || []).forEach((ci: CartItem) => {
        cartQtyMap[ci.menu_item_id] = ci;
    });

    // Locked Merchant UPI ID (per-restaurant UPI ID from database comes first, then env fallback)
    const effectiveUpiId = (
        sessionData.restaurant?.upi_id ||
        import.meta.env.VITE_MERCHANT_UPI_ID ||
        "hellodine@ybl"
    ).trim();
    const upiPayUri = `upi://pay?pa=${encodeURIComponent(effectiveUpiId)}&pn=${encodeURIComponent(
        sessionData.restaurant.name
    )}&am=${ordersGrandTotal.toFixed(2)}&cu=INR&tn=${encodeURIComponent(
        `Table_T${sessionData.table.table_number}_Bill`
    )}`;

    const currentCustomerName = sessionData.customer?.name || `Table T${sessionData.table.table_number} Guest`;
    const isCheckedInForThisSession = checkedInSessionId === sessionData.session?.id;

    // ─── 3. 3D RESTAURANT WELCOME & ADVERTISING LANDING SCREEN (NEW CUSTOMER SESSION) ───
    if (!isCheckedInForThisSession && !goodbyeScreen) {
        const showcaseDishes = [
            ...menuItems.filter((m) => m.is_bestseller),
            ...menuItems.filter((m) => !m.is_bestseller),
        ].slice(0, 4);

        return (
            <div
                style={{
                    minHeight: "100vh",
                    width: "100vw",
                    overflowY: "auto",
                    background:
                        "radial-gradient(circle at 18% 20%, rgba(255,107,53,0.22) 0%, transparent 45%), radial-gradient(circle at 82% 80%, rgba(84,160,255,0.18) 0%, transparent 45%), linear-gradient(135deg, #070810 0%, #121528 50%, #090b14 100%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "28px 20px",
                    perspective: "1200px",
                }}
            >
                <div
                    style={{
                        maxWidth: 1120,
                        width: "100%",
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
                        gap: 28,
                        alignItems: "stretch",
                    }}
                >
                    {/* LEFT: 3D RESTAURANT ADVERTISING & SIGNATURE SHOWCASE CARD */}
                    <div
                        style={{
                            background: "linear-gradient(155deg, rgba(30,35,62,0.92) 0%, rgba(16,19,36,0.96) 100%)",
                            borderRadius: 24,
                            padding: "32px 28px",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow:
                                "0 25px 60px rgba(0,0,0,0.65), 0 0 40px rgba(255,107,53,0.18), inset 0 1px 0 rgba(255,255,255,0.18)",
                            transform: "rotateY(2deg) translateZ(12px)",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            position: "relative",
                            overflow: "hidden",
                        }}
                    >
                        <div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 18 }}>
                                <span
                                    style={{
                                        background: "linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)",
                                        color: "#fff",
                                        padding: "6px 14px",
                                        borderRadius: 999,
                                        fontWeight: 800,
                                        fontSize: "0.8rem",
                                        letterSpacing: "0.04em",
                                        boxShadow: "0 6px 18px rgba(255,107,53,0.4)",
                                    }}
                                >
                                    ✨ SMART AI DINING EXPERIENCE
                                </span>
                                <span
                                    style={{
                                        background: "rgba(35,209,139,0.16)",
                                        border: "1px solid var(--green)",
                                        color: "var(--green)",
                                        padding: "6px 14px",
                                        borderRadius: 999,
                                        fontWeight: 900,
                                        fontSize: "0.9rem",
                                    }}
                                >
                                    🪑 Table T{sessionData.table.table_number}
                                </span>
                            </div>

                            <h1
                                style={{
                                    fontSize: "2.4rem",
                                    fontWeight: 900,
                                    lineHeight: 1.15,
                                    marginBottom: 8,
                                    background: "linear-gradient(90deg, #ffffff 0%, #ffd166 55%, #ff6b35 100%)",
                                    WebkitBackgroundClip: "text",
                                    WebkitTextFillColor: "transparent",
                                }}
                            >
                                {sessionData.restaurant.name}
                            </h1>
                            <div style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginBottom: 20 }}>
                                📍 {sessionData.branch.name}
                                {sessionData.branch.address ? ` · ${sessionData.branch.address}` : ""}
                                {sessionData.branch.city ? `, ${sessionData.branch.city}` : ""}
                            </div>

                            {/* 3D Chef Bestseller Cards */}
                            <div style={{ marginBottom: 20 }}>
                                <div
                                    style={{
                                        fontSize: "0.78rem",
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.08em",
                                        color: "#ffd166",
                                        marginBottom: 12,
                                    }}
                                >
                                    🌟 Chef's Signature Highlights Today
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                                    {showcaseDishes.map((dish) => (
                                        <div
                                            key={dish.id}
                                            style={{
                                                background: "rgba(255,255,255,0.04)",
                                                borderRadius: 14,
                                                overflow: "hidden",
                                                border: "1px solid rgba(255,255,255,0.08)",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 10,
                                                padding: 8,
                                                boxShadow: "0 8px 20px rgba(0,0,0,0.35)",
                                            }}
                                        >
                                            <img
                                                src={getFoodImage(dish.name, dish.is_veg)}
                                                alt={dish.name}
                                                style={{
                                                    width: 54,
                                                    height: 54,
                                                    borderRadius: 10,
                                                    objectFit: "cover",
                                                    flexShrink: 0,
                                                }}
                                            />
                                            <div style={{ minWidth: 0 }}>
                                                <div
                                                    style={{
                                                        fontWeight: 800,
                                                        fontSize: "0.84rem",
                                                        color: "#fff",
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                    }}
                                                >
                                                    {dish.name}
                                                </div>
                                                <div style={{ color: "#ffd166", fontWeight: 800, fontSize: "0.8rem" }}>
                                                    ₹{dish.base_price}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Feature Badges Footer */}
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(3, 1fr)",
                                gap: 10,
                                paddingTop: 16,
                                borderTop: "1px solid rgba(255,255,255,0.08)",
                            }}
                        >
                            <div style={{ background: "rgba(0,0,0,0.28)", padding: "10px 12px", borderRadius: 12, textAlign: "center" }}>
                                <div style={{ fontSize: "1.3rem" }}>🤖🎤</div>
                                <div style={{ fontSize: "0.75rem", fontWeight: 700, marginTop: 4 }}>AI Voice Waiter</div>
                            </div>
                            <div style={{ background: "rgba(0,0,0,0.28)", padding: "10px 12px", borderRadius: 12, textAlign: "center" }}>
                                <div style={{ fontSize: "1.3rem" }}>🎂🎵</div>
                                <div style={{ fontSize: "0.75rem", fontWeight: 700, marginTop: 4 }}>Birthday Music</div>
                            </div>
                            <div style={{ background: "rgba(0,0,0,0.28)", padding: "10px 12px", borderRadius: 12, textAlign: "center" }}>
                                <div style={{ fontSize: "1.3rem" }}>📱🧾</div>
                                <div style={{ fontSize: "0.75rem", fontWeight: 700, marginTop: 4 }}>Instant GST Bill</div>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT: 3D CUSTOMER CHECK-IN & BIRTHDAY CELEBRATION CARD */}
                    <div
                        style={{
                            background: "linear-gradient(155deg, rgba(25,29,52,0.95) 0%, rgba(14,16,30,0.98) 100%)",
                            borderRadius: 24,
                            padding: "32px 28px",
                            border: "1px solid rgba(255,107,53,0.35)",
                            boxShadow:
                                "0 25px 60px rgba(0,0,0,0.65), 0 0 35px rgba(255,107,53,0.15), inset 0 1px 0 rgba(255,255,255,0.15)",
                            transform: "rotateY(-2deg) translateZ(12px)",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                        }}
                    >
                        <div style={{ textAlign: "center", marginBottom: 22 }}>
                            <div style={{ fontSize: "2.8rem", marginBottom: 6 }}>🍽️✨</div>
                            <h2 style={{ fontSize: "1.65rem", fontWeight: 900, color: "#fff", marginBottom: 6 }}>
                                Welcome to Table T{sessionData.table.table_number}!
                            </h2>
                            <p className="text-muted text-sm">
                                Enter your name to start your personalized dining session & receive your GST Invoice in your name.
                            </p>
                        </div>

                        <form onSubmit={handleCustomerCheckinSubmit}>
                            <div className="input-group" style={{ marginBottom: 18 }}>
                                <label className="input-label" style={{ fontSize: "0.85rem", color: "#fff" }}>
                                    👤 Your Name <span style={{ color: "var(--orange)" }}>*</span>
                                </label>
                                <input
                                    className="input"
                                    style={{
                                        padding: "14px 16px",
                                        fontSize: "1.05rem",
                                        borderRadius: 12,
                                        background: "rgba(0,0,0,0.35)",
                                        border: "1px solid rgba(255,255,255,0.18)",
                                    }}
                                    placeholder="e.g. Rahul Sharma"
                                    value={welcomeName}
                                    onChange={(e) => setWelcomeName(e.target.value)}
                                    required
                                    autoFocus
                                />
                            </div>

                            <div
                                style={{
                                    background: "rgba(255,159,67,0.08)",
                                    border: "1px solid rgba(255,159,67,0.3)",
                                    borderRadius: 14,
                                    padding: "14px 16px",
                                    marginBottom: 22,
                                }}
                            >
                                <label className="input-label" style={{ fontSize: "0.82rem", color: "#ffd166", marginBottom: 8, display: "block" }}>
                                    🎂 Date of Birth (Optional — Special Birthday Celebration!)
                                </label>
                                <input
                                    type="date"
                                    className="input"
                                    style={{
                                        padding: "10px 14px",
                                        borderRadius: 10,
                                        background: "rgba(0,0,0,0.35)",
                                        marginBottom: 10,
                                    }}
                                    value={welcomeDob}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setWelcomeDob(val);
                                        if (val) {
                                            const parts = val.split("-");
                                            const now = new Date();
                                            if (
                                                parts.length === 3 &&
                                                parseInt(parts[1], 10) === now.getMonth() + 1 &&
                                                parseInt(parts[2], 10) === now.getDate()
                                            ) {
                                                setWelcomeIsBirthday(true);
                                            }
                                        }
                                    }}
                                />
                                <label
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        cursor: "pointer",
                                        fontSize: "0.85rem",
                                        color: "#fff",
                                        userSelect: "none",
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={welcomeIsBirthday}
                                        onChange={(e) => setWelcomeIsBirthday(e.target.checked)}
                                        style={{ width: 17, height: 17, accentColor: "#ff6b35" }}
                                    />
                                    <span>🎉 Today is my Birthday! (Celebrate with Birthday Song 🎵)</span>
                                </label>
                            </div>

                            <button
                                type="submit"
                                className="btn"
                                disabled={checkingIn}
                                style={{
                                    width: "100%",
                                    padding: "15px 20px",
                                    fontSize: "1.1rem",
                                    fontWeight: 900,
                                    borderRadius: 14,
                                    justifyContent: "center",
                                    background: "linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)",
                                    color: "#fff",
                                    boxShadow: "0 10px 25px rgba(255,107,53,0.4)",
                                }}
                            >
                                {checkingIn ? "Starting Your Table Session…" : "🚀 Start Ordering Menu & AI Waiter"}
                            </button>

                            <button
                                type="button"
                                className="btn btn-outline"
                                style={{
                                    width: "100%",
                                    padding: "12px",
                                    borderRadius: 12,
                                    marginTop: 10,
                                    justifyContent: "center",
                                    border: "1px solid rgba(255,255,255,0.2)",
                                    color: "var(--text-muted)",
                                    fontSize: "0.95rem",
                                }}
                                onClick={() => {
                                    const sessId = sessionData?.session?.id;
                                    if (!sessId) return;
                                    sessionStorage.setItem("hd_kiosk_checkedin_session", sessId);
                                    setCheckedInSessionId(sessId);
                                }}
                            >
                                ⏭️ Skip & Browse Menu Directly
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "70% 30%",
                height: "100vh",
                width: "100vw",
                overflow: "hidden",
                background: "#0b0d14",
            }}
        >
            {/* ═══════════════════════════════════════════════════════════════════════
                LEFT PANEL (70%): MODERN FOOD APP VISUAL MENU & DIRECT CONTROLS
               ═══════════════════════════════════════════════════════════════════════ */}
            <div
                style={{
                    width: "100%",
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    height: "100vh",
                    overflow: "hidden",
                    borderRight: "1px solid var(--border)",
                }}
            >
                {/* TOP HEADER */}
                <header
                    style={{
                        padding: "14px 24px",
                        background: "linear-gradient(90deg, #151828 0%, #1d1936 100%)",
                        borderBottom: "1px solid rgba(255,255,255,0.08)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 12,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div
                            style={{
                                background: "linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)",
                                color: "#fff",
                                fontWeight: 900,
                                fontSize: "1.2rem",
                                padding: "8px 16px",
                                borderRadius: 12,
                                boxShadow: "0 4px 15px rgba(255,107,53,0.35)",
                            }}
                        >
                            T{sessionData.table.table_number}
                        </div>
                        <div>
                            <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#fff" }}>
                                {sessionData.restaurant.name}
                            </div>
                            <div className="text-muted text-sm">
                                📍 {sessionData.branch.name} · 👤 Guest: <strong style={{ color: "#ffd166" }}>{currentCustomerName}</strong>
                            </div>
                        </div>
                    </div>

                    {/* ENTERTAINMENT & INVOICE BUTTONS */}
                    <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                        <button
                            className="btn btn-outline btn-sm"
                            style={{ borderColor: "#f9ca24", color: "#f9ca24" }}
                            onClick={() => sendChatMessage("tell_joke", "😂 Tell me a Joke", true)}
                        >
                            😂 Joke
                        </button>
                        <button
                            className="btn btn-outline btn-sm"
                            style={{ borderColor: "#54a0ff", color: "#54a0ff" }}
                            onClick={() => setShowCartoonModal(true)}
                        >
                            🎬 Kids Cartoons
                        </button>
                        <button
                            className="btn btn-outline btn-sm"
                            style={{ borderColor: "#ff9f43", color: "#ff9f43" }}
                            onClick={() => setShowBirthdayPrompt(true)}
                        >
                            🎂 Birthday
                        </button>
                        {activeOrders.length > 0 && (
                            <button
                                className="btn btn-success btn-sm"
                                style={{ fontWeight: 800 }}
                                onClick={handleOpenBillModalDirect}
                            >
                                🧾 GST Bill & QR Pay (₹{ordersGrandTotal.toFixed(2)})
                            </button>
                        )}
                    </div>
                </header>

                {/* LIVE ORDER STATUS TRACKER BAR */}
                {activeOrders.length > 0 && (
                    <div
                        style={{
                            padding: "10px 24px",
                            background: "linear-gradient(90deg, rgba(255,107,53,0.14), rgba(35,209,139,0.12))",
                            borderBottom: "1px solid var(--border)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            flexWrap: "wrap",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#ff9f43" }}>
                                👨‍🍳 Kitchen Status:
                            </span>
                            {activeOrders.map((ord) => {
                                const stageIdx = ORDER_STAGES.indexOf(ord.status);
                                return (
                                    <div
                                        key={ord.id}
                                        style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 8,
                                            background: "rgba(0,0,0,0.35)",
                                            padding: "4px 12px",
                                            borderRadius: 999,
                                            border: "1px solid rgba(255,255,255,0.1)",
                                            fontSize: "0.78rem",
                                        }}
                                    >
                                        <strong>#{ord.order_number}</strong>
                                        <span className={`badge badge-${ord.status.toLowerCase()}`}>{ord.status}</span>
                                        <span className="text-muted">({stageIdx + 1}/5)</span>
                                    </div>
                                );
                            })}
                        </div>
                        <button
                            className="btn btn-sm"
                            style={{ background: "#ff6b35", color: "#fff", padding: "5px 12px" }}
                            onClick={() => setShowCartoonModal(true)}
                        >
                            🍿 Watch Cartoons While Waiting
                        </button>
                    </div>
                )}

                {/* SEARCH & VEG/NON-VEG FILTER BAR */}
                <div
                    style={{
                        padding: "14px 24px 10px",
                        display: "flex",
                        gap: 12,
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                    }}
                >
                    <input
                        className="input"
                        style={{ maxWidth: 280, padding: "9px 14px", background: "#151828", borderRadius: 999 }}
                        placeholder="🔍 Search your favorite dish…"
                        value={searchQuery}
                        onChange={(e) => {
                            setAiMatchedItemIds(null);
                            setSearchQuery(e.target.value);
                        }}
                    />
                    <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                        {aiMatchedItemIds && (
                            <button
                                className="btn btn-sm"
                                style={{
                                    borderRadius: 999,
                                    background: "rgba(255,159,67,0.18)",
                                    color: "#ff9f43",
                                    border: "1px solid #ff9f43",
                                }}
                                onClick={() => {
                                    setAiMatchedItemIds(null);
                                    setBestsellerOnly(false);
                                    setSelectedCategory("ALL");
                                    setVegFilter("ALL");
                                    setSearchQuery("");
                                }}
                            >
                                ✨ Showing {aiMatchedItemIds.length} AI Results · ✕ Reset
                            </button>
                        )}
                        <button
                            className="btn btn-sm"
                            style={{
                                borderRadius: 999,
                                background: vegFilter === "ALL" && !bestsellerOnly ? "#ff6b35" : "transparent",
                                color: vegFilter === "ALL" && !bestsellerOnly ? "#fff" : "var(--text-muted)",
                                border: "1px solid rgba(255,255,255,0.12)",
                            }}
                            onClick={() => {
                                setAiMatchedItemIds(null);
                                setBestsellerOnly(false);
                                setVegFilter("ALL");
                            }}
                        >
                            All Dishes
                        </button>
                        <button
                            className="btn btn-sm"
                            style={{
                                borderRadius: 999,
                                background: vegFilter === "VEG" ? "var(--green)" : "transparent",
                                color: vegFilter === "VEG" ? "#0b0d14" : "var(--green)",
                                border: "1px solid var(--green)",
                            }}
                            onClick={() => {
                                setAiMatchedItemIds(null);
                                setVegFilter("VEG");
                            }}
                        >
                            🟢 Pure Veg
                        </button>
                        <button
                            className="btn btn-sm"
                            style={{
                                borderRadius: 999,
                                background: vegFilter === "NONVEG" ? "var(--red)" : "transparent",
                                color: vegFilter === "NONVEG" ? "#fff" : "var(--red)",
                                border: "1px solid var(--red)",
                            }}
                            onClick={() => {
                                setAiMatchedItemIds(null);
                                setVegFilter("NONVEG");
                            }}
                        >
                            🔴 Non-Veg
                        </button>
                        <button
                            className="btn btn-sm"
                            style={{
                                borderRadius: 999,
                                background: bestsellerOnly ? "linear-gradient(135deg, #f9ca24, #f0932b)" : "transparent",
                                color: bestsellerOnly ? "#111" : "#f9ca24",
                                border: "1px solid #f9ca24",
                                fontWeight: 800,
                            }}
                            onClick={() => {
                                setAiMatchedItemIds(null);
                                setBestsellerOnly((prev) => !prev);
                            }}
                        >
                            ⭐ Best Dishes
                        </button>
                    </div>
                </div>

                {/* CATEGORY PILLS */}
                <div
                    style={{
                        padding: "0 24px 12px",
                        display: "flex",
                        gap: 8,
                        overflowX: "auto",
                        borderBottom: "1px solid var(--border)",
                    }}
                >
                    <button
                        className="btn btn-sm"
                        style={{
                            borderRadius: 999,
                            background: selectedCategory === "ALL" && !aiMatchedItemIds ? "linear-gradient(135deg, #ff6b35, #f7931e)" : "#151828",
                            color: "#fff",
                            border: "1px solid rgba(255,255,255,0.08)",
                        }}
                        onClick={() => {
                            setAiMatchedItemIds(null);
                            setSelectedCategory("ALL");
                            setSearchQuery("");
                        }}
                    >
                        🔥 All Menu
                    </button>
                    {categories.map((cat) => (
                        <button
                            key={cat.id}
                            className="btn btn-sm"
                            style={{
                                borderRadius: 999,
                                background:
                                    selectedCategory === cat.id
                                        ? "linear-gradient(135deg, #ff6b35, #f7931e)"
                                        : "#151828",
                                color: selectedCategory === cat.id ? "#fff" : "var(--text)",
                                border: "1px solid rgba(255,255,255,0.08)",
                            }}
                            onClick={() => {
                                setAiMatchedItemIds(null);
                                setSelectedCategory(cat.id);
                                setSearchQuery("");
                            }}
                        >
                            {cat.name}
                        </button>
                    ))}
                </div>

                {/* ATTRACTIVE FOOD APP MENU GRID WITH IMAGES */}
                <div
                    style={{
                        flex: 1,
                        overflowY: "auto",
                        padding: "16px 20px",
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
                        gridAutoRows: "max-content",
                        gap: 16,
                        alignContent: "start",
                    }}
                >
                    {filteredItems.map((item) => {
                        const inCart = cartQtyMap[item.id];
                        const imgUrl = getFoodImage(item.name, item.is_veg);
                        const fallbackSvg = getFoodFallbackSvg(item.name, item.is_veg);
                        return (
                            <div
                                key={item.id}
                                style={{
                                    background: "#161a2d",
                                    borderRadius: 16,
                                    overflow: "hidden",
                                    minHeight: 295,
                                    height: "auto",
                                    border: inCart ? "2px solid #ff6b35" : "1px solid rgba(255,255,255,0.1)",
                                    boxShadow: inCart
                                        ? "0 8px 26px rgba(255,107,53,0.25)"
                                        : "0 6px 20px rgba(0,0,0,0.4)",
                                    display: "flex",
                                    flexDirection: "column",
                                    justifyContent: "space-between",
                                }}
                            >
                                <div>
                                    {/* Dish Photo + Automatic Offline SVG Fallback + Floating Badges */}
                                    <div style={{ position: "relative", height: 150, width: "100%", overflow: "hidden", background: "#1e2238", flexShrink: 0 }}>
                                        <img
                                            src={imgUrl}
                                            alt={item.name}
                                            loading="lazy"
                                            onError={(e) => {
                                                const target = e.currentTarget;
                                                if (target.src !== fallbackSvg) {
                                                    target.src = fallbackSvg;
                                                }
                                            }}
                                            style={{ width: "100%", height: "150px", objectFit: "cover", display: "block" }}
                                        />
                                        <div
                                            style={{
                                                position: "absolute",
                                                top: 10,
                                                left: 10,
                                                background: "rgba(11,13,20,0.88)",
                                                padding: "4px 10px",
                                                borderRadius: 999,
                                                fontSize: "0.7rem",
                                                fontWeight: 800,
                                                color: item.is_veg ? "var(--green)" : "var(--red)",
                                                border: `1px solid ${item.is_veg ? "var(--green)" : "var(--red)"}`,
                                            }}
                                        >
                                            {item.is_veg ? "🟢 VEG" : "🔴 NON-VEG"}
                                        </div>
                                        {item.is_bestseller && (
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    bottom: 10,
                                                    left: 10,
                                                    background: "linear-gradient(135deg, #f9ca24, #f0932b)",
                                                    padding: "3px 10px",
                                                    borderRadius: 999,
                                                    fontSize: "0.68rem",
                                                    fontWeight: 900,
                                                    color: "#111",
                                                    boxShadow: "0 3px 10px rgba(0,0,0,0.45)",
                                                }}
                                            >
                                                ⭐ BESTSELLER
                                            </div>
                                        )}
                                        {item.spice_level && (
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    top: 10,
                                                    right: 10,
                                                    background: "rgba(11,13,20,0.85)",
                                                    padding: "4px 9px",
                                                    borderRadius: 999,
                                                    fontSize: "0.68rem",
                                                    fontWeight: 700,
                                                    color: "#ff9f43",
                                                }}
                                            >
                                                🌶️ {item.spice_level.toUpperCase()}
                                            </div>
                                        )}
                                    </div>

                                    {/* Dish Name & Description */}
                                    <div style={{ padding: "14px 16px 8px" }}>
                                        <div
                                            style={{
                                                fontSize: "1.05rem",
                                                fontWeight: 800,
                                                color: "#ffffff",
                                                marginBottom: 6,
                                                lineHeight: 1.3,
                                            }}
                                        >
                                            {item.name}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: "0.78rem",
                                                color: "#9ca3c7",
                                                lineHeight: 1.4,
                                                minHeight: 34,
                                            }}
                                        >
                                            {item.description || `Freshly prepared ${item.name} cooked with authentic spices`}
                                        </div>
                                    </div>
                                </div>


                                {/* Price & Instant Add/+/- Controls */}
                                <div
                                    style={{
                                        padding: "10px 16px 14px",
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                    }}
                                >
                                    <div>
                                        <div style={{ fontSize: "1.18rem", fontWeight: 900, color: "#fff" }}>
                                            ₹{item.base_price.toFixed(0)}
                                        </div>
                                        <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                                            +{item.gst_percent}% GST
                                        </div>
                                    </div>

                                    {inCart ? (
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                                background: "rgba(255,107,53,0.15)",
                                                border: "1px solid #ff6b35",
                                                borderRadius: 10,
                                                padding: "4px 6px",
                                            }}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => handleUpdateCartQty(inCart, inCart.quantity - 1)}
                                                style={{
                                                    width: 28,
                                                    height: 28,
                                                    borderRadius: 7,
                                                    border: "none",
                                                    background: "#151828",
                                                    color: "#fff",
                                                    fontWeight: 900,
                                                    cursor: "pointer",
                                                }}
                                            >
                                                −
                                            </button>
                                            <span style={{ fontWeight: 900, minWidth: 22, textAlign: "center", color: "#ff9f43" }}>
                                                {inCart.quantity}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleUpdateCartQty(inCart, inCart.quantity + 1)}
                                                style={{
                                                    width: 28,
                                                    height: 28,
                                                    borderRadius: 7,
                                                    border: "none",
                                                    background: "#ff6b35",
                                                    color: "#fff",
                                                    fontWeight: 900,
                                                    cursor: "pointer",
                                                }}
                                            >
                                                +
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => handleAddItem(item)}
                                            style={{
                                                background: "linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)",
                                                color: "#fff",
                                                border: "none",
                                                borderRadius: 10,
                                                padding: "9px 20px",
                                                fontWeight: 800,
                                                fontSize: "0.86rem",
                                                cursor: "pointer",
                                                boxShadow: "0 4px 12px rgba(255,107,53,0.3)",
                                            }}
                                        >
                                            + ADD
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* BOTTOM CART & ORDER BAR */}
                <div
                    style={{
                        padding: "14px 24px",
                        background: "#151828",
                        borderTop: "1px solid rgba(255,255,255,0.1)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 16,
                        flexWrap: "wrap",
                    }}
                >
                    <div>
                        <div className="flex items-center gap-2">
                            <div style={{ fontWeight: 800, fontSize: "1rem" }}>
                                🛒 Cart: {(cart.items || []).reduce((s: number, i: CartItem) => s + i.quantity, 0)} items
                                {" · "}
                                <span style={{ color: "var(--green)" }}>₹{Number(cart.total || 0).toFixed(2)}</span>
                            </div>
                            {cart.items?.length > 0 && (
                                <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    style={{
                                        padding: "3px 10px",
                                        fontSize: "0.75rem",
                                        color: "var(--red)",
                                        borderColor: "var(--red)",
                                        fontWeight: 800,
                                    }}
                                    onClick={() => setShowCartRemoveModal(true)}
                                >
                                    🗑️ Remove Item
                                </button>
                            )}
                        </div>
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Subtotal ₹{Number(cart.subtotal || 0).toFixed(2)} + CGST ₹{Number(cart.cgst_amount || 0).toFixed(2)} + SGST ₹{Number(cart.sgst_amount || 0).toFixed(2)}
                        </div>
                    </div>


                    <div className="flex gap-2">
                        {cart.items?.length > 0 && (
                            <button
                                type="button"
                                onClick={handleInitiatePlaceOrder}
                                style={{
                                    background: "linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: 10,
                                    padding: "11px 22px",
                                    fontWeight: 800,
                                    fontSize: "0.92rem",
                                    cursor: "pointer",
                                    boxShadow: "0 4px 15px rgba(255,107,53,0.35)",
                                }}
                            >
                                🍽️ Place Order to Kitchen (₹{Number(cart.total).toFixed(2)})
                            </button>
                        )}
                        {activeOrders.length > 0 && (
                            <button className="btn btn-success" onClick={handleOpenBillModalDirect}>
                                🧾 View Total GST Bill & Pay (₹{ordersGrandTotal.toFixed(2)})
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════════════
                RIGHT PANEL (30%): AI VOICE & CHAT WAITER ASSISTANT
               ═══════════════════════════════════════════════════════════════════════ */}
            <div
                style={{
                    width: "100%",
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    height: "100vh",
                    overflow: "hidden",
                    background: "#121524",
                }}
            >
                {/* AI ASSISTANT HEADER */}
                <div
                    style={{
                        padding: "14px 18px",
                        background: "#151828",
                        borderBottom: "1px solid var(--border)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}
                >
                    <div className="flex items-center gap-2">
                        <div
                            style={{
                                width: 38,
                                height: 38,
                                borderRadius: "50%",
                                background: "rgba(255,107,53,0.18)",
                                border: "1px solid #ff6b35",
                                display: "grid",
                                placeItems: "center",
                                fontSize: "1.2rem",
                            }}
                        >
                            🤖
                        </div>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: "0.96rem" }}>HelloDine AI Waiter</div>
                            <div style={{ fontSize: "0.72rem", color: "var(--green)" }}>
                                ● Ask about food, prices, GST bill, or say "confirm order"
                            </div>
                        </div>
                    </div>

                    <button
                        className={`btn btn-sm ${voiceEnabled ? "btn-primary" : "btn-outline"}`}
                        onClick={() => {
                            if (voiceEnabled && "speechSynthesis" in window) window.speechSynthesis.cancel();
                            setVoiceEnabled(!voiceEnabled);
                        }}
                    >
                        {voiceEnabled ? "🔊 AI Voice On" : "🔇 Muted"}
                    </button>
                </div>

                {/* CHAT MESSAGES STREAM */}
                <div
                    style={{
                        flex: 1,
                        overflowY: "auto",
                        padding: "16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                    }}
                >
                    {messages.map((m) => (
                        <div
                            key={m.id}
                            style={{
                                alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
                                maxWidth: "88%",
                            }}
                        >
                            <div
                                style={{
                                    background:
                                        m.sender === "user"
                                            ? "linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)"
                                            : "#1b1f34",
                                    color: "#fff",
                                    padding: "12px 14px",
                                    borderRadius: m.sender === "user" ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                                    border: "1px solid rgba(255,255,255,0.08)",
                                    fontSize: "0.88rem",
                                    lineHeight: 1.5,
                                    whiteSpace: "pre-line",
                                }}
                            >
                                {m.text}
                            </div>

                            {m.buttons && m.buttons.length > 0 && (
                                <div className="flex gap-2" style={{ marginTop: 8, flexWrap: "wrap" }}>
                                    {m.buttons
                                        .filter((b) => !(b.id === "cancel_order" && !hasCancellableOrder))
                                        .map((b) => (
                                            <button
                                                key={b.id}
                                                className="btn btn-outline btn-sm"
                                                style={{ background: "#1b1f34", borderColor: "#ff6b35", color: "#fff" }}
                                                onClick={() => sendChatMessage(b.id, b.title, true)}
                                            >
                                                {b.title}
                                            </button>
                                        ))}
                                </div>
                            )}

                            <div
                                className="text-muted"
                                style={{
                                    fontSize: "0.68rem",
                                    marginTop: 4,
                                    textAlign: m.sender === "user" ? "right" : "left",
                                }}
                            >
                                {m.time}
                            </div>
                        </div>
                    ))}

                    {botThinking && (
                        <div
                            style={{
                                alignSelf: "flex-start",
                                background: "#1b1f34",
                                padding: "10px 14px",
                                borderRadius: 12,
                                fontSize: "0.84rem",
                                color: "var(--text-muted)",
                            }}
                        >
                            🤖 AI Waiter is replying…
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>

                {/* QUICK CHIPS FOR AI CHAT (Confirm, Order Status, Cancel Order, Bill) */}
                <div
                    style={{
                        padding: "8px 14px",
                        borderTop: "1px solid var(--border)",
                        display: "flex",
                        gap: 6,
                        overflowX: "auto",
                        background: "rgba(0,0,0,0.2)",
                    }}
                >
                    <button
                        className="btn btn-outline btn-sm"
                        style={{ borderColor: "var(--green)", color: "var(--green)" }}
                        onClick={() => sendChatMessage("confirm order", "✅ Confirm Order", true)}
                    >
                        ✅ Confirm Order
                    </button>
                    {activeOrders.length > 0 && (
                        <button
                            className="btn btn-outline btn-sm"
                            style={{ borderColor: "#54a0ff", color: "#54a0ff" }}
                            onClick={() => sendChatMessage("order_status", "👨‍🍳 Check Order Status", true)}
                        >
                            👨‍🍳 Order Status
                        </button>
                    )}
                    {hasCancellableOrder && (
                        <button
                            className="btn btn-outline btn-sm"
                            style={{ borderColor: "var(--red)", color: "var(--red)" }}
                            onClick={() => sendChatMessage("cancel order", "❌ Cancel Order", true)}
                        >
                            ❌ Cancel Order
                        </button>
                    )}
                    <button
                        className="btn btn-outline btn-sm"
                        onClick={() => sendChatMessage("how much is my total bill with gst", "🧾 How much is my bill?", true)}
                    >
                        🧾 Ask Bill
                    </button>
                </div>

                {/* VOICE TRANSCRIPT NOTICE BAR (When voice is listening or needs review) */}
                {voiceTranscriptNotice && (
                    <div
                        style={{
                            padding: "6px 14px",
                            background: "rgba(255,159,67,0.15)",
                            borderTop: "1px solid rgba(255,159,67,0.35)",
                            color: "#ff9f43",
                            fontSize: "0.76rem",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                        }}
                    >
                        <span>{voiceTranscriptNotice}</span>
                        <button
                            type="button"
                            onClick={() => setVoiceTranscriptNotice("")}
                            style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: "0.75rem" }}
                        >
                            ✕
                        </button>
                    </div>
                )}

                {/* VOICE MIC + CHAT INPUT BOX */}
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        setVoiceTranscriptNotice("");
                        sendChatMessage(undefined, undefined, true);
                    }}
                    style={{
                        padding: "12px 14px",
                        background: "#151828",
                        borderTop: "1px solid var(--border)",
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                    }}
                >
                    <button
                        type="button"
                        onClick={toggleVoiceInput}
                        className={`btn ${isListening ? "btn-danger pulse" : "btn-outline"}`}
                        style={{
                            padding: isListening ? "10px 14px" : "10px 14px",
                            borderRadius: isListening ? 20 : "50%",
                            borderColor: isListening ? "var(--red)" : "#ff6b35",
                            fontWeight: isListening ? 800 : "normal",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                        }}
                        title={isListening ? "Tap to Finish & Send" : "Tap and speak to AI Bot"}
                    >
                        {isListening ? "⏹️ Done" : "🎤"}
                    </button>
                    <input
                        className="input"
                        style={{ flex: 1, minWidth: 0 }}
                        placeholder={isListening ? "Listening… speak now!" : "Chat or say 'confirm order', 'how much is my bill'…"}
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                    />
                    <button
                        type="submit"
                        className="btn"
                        style={{ background: "#ff6b35", color: "#fff" }}
                        disabled={botThinking}
                    >
                        Send
                    </button>
                </form>
            </div>

            {/* ═══════════════════════════════════════════════════════════════════════
                MODAL A0: INTERACTIVE REMOVE CART ITEMS MODAL (Single Item Cross ✕ or Remove All)
               ═══════════════════════════════════════════════════════════════════════ */}
            {showCartRemoveModal && (
                <div className="modal-overlay" onClick={() => setShowCartRemoveModal(false)}>
                    <div className="card modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
                            <h2 style={{ margin: 0, fontSize: "1.25rem" }}>🛒 Manage / Remove Cart Items</h2>
                            <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => setShowCartRemoveModal(false)}
                            >
                                ✕ Close
                            </button>
                        </div>
                        <p className="text-muted text-sm" style={{ marginBottom: 14 }}>
                            Tap <strong>✕</strong> next to any item to remove it from your cart, or tap{" "}
                            <strong>Remove All</strong> to empty your cart:
                        </p>

                        <div
                            style={{
                                background: "var(--bg-base)",
                                padding: 14,
                                borderRadius: 12,
                                border: "1px solid var(--border)",
                                marginBottom: 18,
                                maxHeight: 280,
                                overflowY: "auto",
                            }}
                        >
                            {(cart.items || []).length === 0 ? (
                                <div className="text-muted text-sm" style={{ textAlign: "center", padding: "18px 0" }}>
                                    Your cart is now empty.
                                </div>
                            ) : (
                                (cart.items || []).map((ci: CartItem) => (
                                    <div
                                        key={ci.menu_item_id}
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: 10,
                                            padding: "10px 6px",
                                            borderBottom: "1px dashed var(--border)",
                                        }}
                                    >
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#fff" }}>
                                                {ci.is_veg ? "🟢" : "🔴"} {ci.name}
                                            </div>
                                            <div className="text-muted text-sm">
                                                Qty: <strong>×{ci.quantity}</strong> · ₹{Number(ci.line_total).toFixed(2)}
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => handleRemoveCartItemCompletely(ci)}
                                            style={{
                                                background: "rgba(255,95,87,0.15)",
                                                color: "var(--red)",
                                                border: "1px solid var(--red)",
                                                borderRadius: 8,
                                                padding: "6px 12px",
                                                fontWeight: 800,
                                                fontSize: "0.82rem",
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 5,
                                                flexShrink: 0,
                                            }}
                                            title={`Remove ${ci.name} from cart`}
                                        >
                                            ✕ Remove
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="flex gap-2">
                            <button
                                type="button"
                                className="btn btn-outline"
                                style={{ flex: 1, justifyContent: "center" }}
                                onClick={() => setShowCartRemoveModal(false)}
                            >
                                Done
                            </button>
                            {(cart.items || []).length > 0 && (
                                <button
                                    type="button"
                                    className="btn btn-danger"
                                    style={{ flex: 1, justifyContent: "center", fontWeight: 800 }}
                                    onClick={handleClearAllCartItems}
                                >
                                    🗑️ Remove All ({cart.items.length})
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════════
                MODAL A: LEFT-SIDE ORDER CONFIRMATION (Requirement 3 & 8)
               ═══════════════════════════════════════════════════════════════════════ */}
            {showOrderConfirmModal && (
                <div className="modal-overlay" onClick={() => setShowOrderConfirmModal(false)}>
                    <div className="card modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ marginBottom: 6 }}>🍽️ Confirm Order for Kitchen</h2>
                        <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
                            Please review your selected items for Table T{sessionData.table.table_number}:
                        </p>

                        <div
                            style={{
                                background: "var(--bg-base)",
                                padding: 16,
                                borderRadius: 12,
                                border: "1px solid var(--border)",
                                marginBottom: 18,
                                maxHeight: 240,
                                overflowY: "auto",
                            }}
                        >
                            {(cart.items || []).map((ci: CartItem) => (
                                <div
                                    key={ci.menu_item_id}
                                    className="flex justify-between text-sm"
                                    style={{ padding: "7px 0", borderBottom: "1px dashed var(--border)" }}
                                >
                                    <span>
                                        {ci.is_veg ? "🟢" : "🔴"} <strong>{ci.name}</strong> ×{ci.quantity}
                                    </span>
                                    <span style={{ fontWeight: 700 }}>₹{Number(ci.line_total).toFixed(2)}</span>
                                </div>
                            ))}
                            <div className="flex justify-between text-sm" style={{ marginTop: 10 }}>
                                <span className="text-muted">Subtotal</span>
                                <span>₹{Number(cart.subtotal).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-sm" style={{ marginTop: 4 }}>
                                <span className="text-muted">GST (CGST + SGST)</span>
                                <span>₹{(Number(cart.cgst_amount) + Number(cart.sgst_amount)).toFixed(2)}</span>
                            </div>
                            <div
                                className="flex justify-between"
                                style={{
                                    marginTop: 10,
                                    paddingTop: 10,
                                    borderTop: "1px solid var(--border)",
                                    fontWeight: 900,
                                    fontSize: "1.15rem",
                                    color: "var(--green)",
                                }}
                            >
                                <span>Total Payable</span>
                                <span>₹{Number(cart.total).toFixed(2)}</span>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <button
                                className="btn btn-outline"
                                style={{ flex: 1, justifyContent: "center" }}
                                onClick={() => setShowOrderConfirmModal(false)}
                            >
                                ✏️ Edit Items
                            </button>
                            <button
                                className="btn btn-success"
                                style={{ flex: 1, justifyContent: "center" }}
                                onClick={handleConfirmSendToKitchen}
                                disabled={placingOrder}
                            >
                                {placingOrder ? "Sending to Kitchen…" : "✅ Confirm & Send to Kitchen"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════════
                MODAL B: KIDS CARTOON THEATRE (Requirement 5: Working Video Player)
               ═══════════════════════════════════════════════════════════════════════ */}
            {showCartoonModal && (
                <div className="modal-overlay" onClick={() => setShowCartoonModal(false)}>
                    <div
                        className="card modal"
                        style={{ maxWidth: 820, width: "95%" }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                            <div>
                                <h2 style={{ fontSize: "1.4rem", fontWeight: 800 }}>
                                    🎬 Kids Cartoon Theatre 🧸🍿
                                </h2>
                                <p className="text-muted text-sm">
                                    Switch between Direct HD Video or YouTube Cartoon Player anytime!
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    className={`btn btn-sm ${videoMode === "mp4" ? "btn-primary" : "btn-outline"}`}
                                    onClick={() => setVideoMode("mp4")}
                                >
                                    🎞️ Direct Video Player
                                </button>
                                <button
                                    className={`btn btn-sm ${videoMode === "youtube" ? "btn-primary" : "btn-outline"}`}
                                    onClick={() => setVideoMode("youtube")}
                                >
                                    ▶️ YouTube Embed
                                </button>
                                <button className="btn btn-outline btn-sm" onClick={() => setShowCartoonModal(false)}>
                                    ✕ Close
                                </button>
                            </div>
                        </div>

                        {/* VIDEO PLAYER */}
                        <div style={{ background: "#000", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
                            {videoMode === "youtube" ? (
                                <iframe
                                    key={customVideoUrl || activeCartoon.youtubeEmbed}
                                    src={customVideoUrl || activeCartoon.youtubeEmbed}
                                    title={activeCartoon.title}
                                    style={{ width: "100%", height: 390, border: "none", display: "block" }}
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                    allowFullScreen
                                />
                            ) : (
                                <video
                                    key={customVideoUrl || activeCartoon.mp4Fallback}
                                    src={customVideoUrl || activeCartoon.mp4Fallback}
                                    controls
                                    autoPlay
                                    playsInline
                                    style={{ width: "100%", maxHeight: 390, display: "block" }}
                                />
                            )}
                        </div>

                        {/* EPISODE SELECTOR */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
                            {CARTOON_VIDEOS.map((vid) => (
                                <div
                                    key={vid.id}
                                    onClick={() => {
                                        setCustomVideoUrl("");
                                        setActiveCartoon(vid);
                                        setVideoMode(vid.type);
                                    }}
                                    className="card"
                                    style={{
                                        padding: 10,
                                        cursor: "pointer",
                                        border:
                                            activeCartoon.id === vid.id
                                                ? "2px solid #ff6b35"
                                                : "1px solid var(--border)",
                                    }}
                                >
                                    <span className="badge badge-new" style={{ marginBottom: 4 }}>
                                        {vid.badge}
                                    </span>
                                    <div style={{ fontWeight: 700, fontSize: "0.84rem" }}>{vid.title}</div>
                                    <div className="text-muted" style={{ fontSize: "0.72rem" }}>{vid.subtitle}</div>
                                </div>
                            ))}
                        </div>

                        {/* CUSTOM VIDEO / YOUTUBE URL INPUT */}
                        <div className="flex gap-2 items-center" style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                            <input
                                className="input"
                                style={{ fontSize: "0.8rem", padding: "7px 12px" }}
                                placeholder="Paste any YouTube link or MP4 video URL to play for kids…"
                                value={customVideoUrl}
                                onChange={(e) => {
                                    const val = e.target.value.trim();
                                    if (val.includes("youtube.com/watch?v=")) {
                                        const vId = val.split("v=")[1]?.split("&")[0];
                                        setCustomVideoUrl(`https://www.youtube.com/embed/${vId}?autoplay=1`);
                                        setVideoMode("youtube");
                                    } else if (val.includes("youtu.be/")) {
                                        const vId = val.split("youtu.be/")[1]?.split("?")[0];
                                        setCustomVideoUrl(`https://www.youtube.com/embed/${vId}?autoplay=1`);
                                        setVideoMode("youtube");
                                    } else {
                                        setCustomVideoUrl(val);
                                    }
                                }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════════
                MODAL C: BIRTHDAY NAME INPUT PROMPT
               ═══════════════════════════════════════════════════════════════════════ */}
            {showBirthdayPrompt && (
                <div className="modal-overlay" onClick={() => setShowBirthdayPrompt(false)}>
                    <div className="card modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ marginBottom: 8 }}>🎂 Celebrating a Birthday Today?</h2>
                        <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
                            Enter the birthday boy or girl's name and our AI will play a special birthday song & celebration on the screen!
                        </p>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (!birthdayInputName.trim()) return;
                                const name = birthdayInputName.trim();
                                setShowBirthdayPrompt(false);
                                setBirthdayInputName("");
                                sendChatMessage(`Today is ${name}'s birthday`, `🎂 Celebrate ${name}'s Birthday!`, true);
                            }}
                        >
                            <div className="input-group">
                                <label className="input-label">Birthday Boy / Girl's Name</label>
                                <input
                                    className="input"
                                    placeholder="e.g. Aarav / Ananya"
                                    value={birthdayInputName}
                                    onChange={(e) => setBirthdayInputName(e.target.value)}
                                    autoFocus
                                    required
                                />
                            </div>
                            <div className="flex gap-2">
                                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setShowBirthdayPrompt(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                                    🎉 Start Celebration!
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════════
                MODAL D: FULL-SCREEN 3D BIRTHDAY CELEBRATION WITH FIREWORKS, FLOWERS & STARS
               ═══════════════════════════════════════════════════════════════════════ */}
            {birthdayOverlay && (
                <div
                    className="modal-overlay"
                    style={{
                        background:
                            "radial-gradient(circle at 50% 35%, rgba(255,107,53,0.42) 0%, rgba(120,40,180,0.38) 40%, rgba(8,8,18,0.96) 85%)",
                        perspective: "1400px",
                        overflow: "hidden",
                        zIndex: 9999,
                    }}
                    onClick={() => {
                        if (stopMusicRef.current) stopMusicRef.current();
                        setBirthdayOverlay(null);
                    }}
                >
                    {/* 3D Keyframe Animations for Flowers, Sparkling Stars, and Firework Crackers */}
                    <style>{`
                        @keyframes hdFlowerFall3D {
                            0% {
                                transform: translate3d(0, -12vh, 80px) rotateX(0deg) rotateY(0deg) rotateZ(0deg) scale(0.8);
                                opacity: 0;
                            }
                            15% {
                                opacity: 1;
                            }
                            50% {
                                transform: translate3d(35px, 45vh, 140px) rotateX(180deg) rotateY(180deg) rotateZ(120deg) scale(1.2);
                            }
                            85% {
                                opacity: 1;
                            }
                            100% {
                                transform: translate3d(-30px, 108vh, 40px) rotateX(360deg) rotateY(360deg) rotateZ(280deg) scale(0.9);
                                opacity: 0;
                            }
                        }
                        @keyframes hdBalloonFloatUp3D {
                            0% {
                                transform: translate3d(0, 110vh, 60px) rotateZ(-8deg) scale(0.85);
                                opacity: 0;
                            }
                            15% { opacity: 0.95; }
                            50% {
                                transform: translate3d(-25px, 45vh, 130px) rotateZ(8deg) scale(1.1);
                            }
                            85% { opacity: 0.95; }
                            100% {
                                transform: translate3d(25px, -20vh, 60px) rotateZ(-6deg) scale(0.95);
                                opacity: 0;
                            }
                        }
                        @keyframes hdStarSparkle3D {
                            0%, 100% {
                                transform: translateZ(50px) scale(0.4) rotate(0deg);
                                opacity: 0.25;
                                filter: drop-shadow(0 0 4px #ffd166);
                            }
                            50% {
                                transform: translateZ(180px) scale(1.45) rotate(180deg);
                                opacity: 1;
                                filter: drop-shadow(0 0 18px #fff) drop-shadow(0 0 28px #ffd166);
                            }
                        }
                        @keyframes hdCrackerBurst3D {
                            0% {
                                transform: scale(0.1) rotateZ(0deg);
                                opacity: 1;
                            }
                            50% {
                                opacity: 1;
                            }
                            100% {
                                transform: scale(2.4) rotateZ(45deg);
                                opacity: 0;
                            }
                        }
                        @keyframes hdCardFloat3D {
                            0%, 100% {
                                transform: rotateX(4deg) rotateY(-4deg) translateZ(30px) translateY(0px);
                            }
                            50% {
                                transform: rotateX(-4deg) rotateY(4deg) translateZ(55px) translateY(-10px);
                            }
                        }
                        @keyframes hdCakePulse3D {
                            0%, 100% {
                                transform: translateZ(60px) scale(1);
                            }
                            50% {
                                transform: translateZ(95px) scale(1.14);
                            }
                        }
                    `}</style>

                    {/* 1. 3D FALLING FLOWERS & PETALS LAYER */}
                    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", transformStyle: "preserve-3d" }}>
                        {Array.from({ length: 28 }).map((_, i) => {
                            const flowers = ["🌸", "🌺", "🌹", "🌷", "🌼", "💐", "🌻", "✨", "🎊"];
                            const icon = flowers[i % flowers.length];
                            const left = `${(i * 3.7) % 98}%`;
                            const delay = `${(i * 0.27) % 5}s`;
                            const duration = `${4.2 + (i % 4) * 0.85}s`;
                            const fontSize = `${1.4 + (i % 3) * 0.55}rem`;
                            return (
                                <div
                                    key={`flower-${i}`}
                                    style={{
                                        position: "absolute",
                                        top: "-10%",
                                        left,
                                        fontSize,
                                        animation: `hdFlowerFall3D ${duration} ease-in-out ${delay} infinite`,
                                        filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.45))",
                                    }}
                                >
                                    {icon}
                                </div>
                            );
                        })}
                    </div>

                    {/* 2. 3D FLOATING BALLOONS & PARTY POPPERS LAYER */}
                    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", transformStyle: "preserve-3d" }}>
                        {Array.from({ length: 12 }).map((_, i) => {
                            const balloons = ["🎈", "🎉", "🎊", "🥳", "🎁", "🎈"];
                            const icon = balloons[i % balloons.length];
                            const left = `${4 + (i * 8.3) % 92}%`;
                            const delay = `${(i * 0.45) % 4}s`;
                            const duration = `${5.5 + (i % 3) * 1.1}s`;
                            return (
                                <div
                                    key={`balloon-${i}`}
                                    style={{
                                        position: "absolute",
                                        bottom: "-15%",
                                        left,
                                        fontSize: "2.3rem",
                                        animation: `hdBalloonFloatUp3D ${duration} ease-in-out ${delay} infinite`,
                                        filter: "drop-shadow(0 12px 18px rgba(0,0,0,0.5))",
                                    }}
                                >
                                    {icon}
                                </div>
                            );
                        })}
                    </div>

                    {/* 3. 3D SPARKLING STARS LAYER */}
                    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", transformStyle: "preserve-3d" }}>
                        {Array.from({ length: 22 }).map((_, i) => {
                            const stars = ["⭐", "🌟", "✨", "💫", "⚡"];
                            const icon = stars[i % stars.length];
                            const top = `${6 + ((i * 17) % 86)}%`;
                            const left = `${3 + ((i * 23) % 94)}%`;
                            const delay = `${(i * 0.19) % 2.5}s`;
                            const duration = `${1.6 + (i % 3) * 0.55}s`;
                            return (
                                <div
                                    key={`star-${i}`}
                                    style={{
                                        position: "absolute",
                                        top,
                                        left,
                                        fontSize: `${1.2 + (i % 3) * 0.5}rem`,
                                        animation: `hdStarSparkle3D ${duration} ease-in-out ${delay} infinite`,
                                    }}
                                >
                                    {icon}
                                </div>
                            );
                        })}
                    </div>

                    {/* 4. 3D FIREWORK CRACKER BURSTS IN SKY */}
                    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
                        {[
                            { top: "14%", left: "16%", color: "#ff6b35", delay: "0s" },
                            { top: "18%", left: "82%", color: "#ffd166", delay: "0.6s" },
                            { top: "76%", left: "14%", color: "#23d18b", delay: "1.1s" },
                            { top: "74%", left: "84%", color: "#54a0ff", delay: "0.3s" },
                            { top: "12%", left: "50%", color: "#ff4757", delay: "0.9s" },
                            { top: "45%", left: "8%", color: "#e056fd", delay: "1.4s" },
                            { top: "45%", left: "91%", color: "#ff9f43", delay: "0.4s" },
                        ].map((fw, idx) => (
                            <div
                                key={`cracker-${idx}`}
                                style={{
                                    position: "absolute",
                                    top: fw.top,
                                    left: fw.left,
                                    width: 140,
                                    height: 140,
                                    marginLeft: -70,
                                    marginTop: -70,
                                    borderRadius: "50%",
                                    background: `radial-gradient(circle, ${fw.color} 0%, transparent 68%)`,
                                    boxShadow: `0 0 45px ${fw.color}, 0 0 90px ${fw.color}`,
                                    animation: `hdCrackerBurst3D 2.1s ease-out ${fw.delay} infinite`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: "2.6rem",
                                }}
                            >
                                🎆🎇
                            </div>
                        ))}
                    </div>

                    {/* 5. CENTER 3D FLOATING BIRTHDAY STAGE CARD */}
                    <div
                        className="card modal"
                        style={{
                            maxWidth: 660,
                            width: "92%",
                            textAlign: "center",
                            padding: "46px 36px",
                            background:
                                "linear-gradient(155deg, rgba(32,20,56,0.92) 0%, rgba(18,16,38,0.96) 55%, rgba(36,22,42,0.94) 100%)",
                            border: "2px solid rgba(255,209,102,0.75)",
                            borderRadius: 28,
                            boxShadow:
                                "0 30px 80px rgba(0,0,0,0.85), 0 0 65px rgba(255,159,67,0.55), 0 0 110px rgba(255,107,53,0.35), inset 0 2px 0 rgba(255,255,255,0.28)",
                            animation: "hdCardFloat3D 5s ease-in-out infinite",
                            transformStyle: "preserve-3d",
                            position: "relative",
                            zIndex: 10,
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Corner Floral & Cracker Accents */}
                        <div style={{ position: "absolute", top: 14, left: 18, fontSize: "2rem", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.5))" }}>
                            🌸🎆🌟
                        </div>
                        <div style={{ position: "absolute", top: 14, right: 18, fontSize: "2rem", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.5))" }}>
                            🌟🎇🌺
                        </div>

                        {/* 3D Pulsing Cake & Fireworks Crown */}
                        <div
                            style={{
                                fontSize: "4.6rem",
                                marginBottom: 12,
                                animation: "hdCakePulse3D 2.2s ease-in-out infinite",
                                filter: "drop-shadow(0 14px 24px rgba(255,159,67,0.55))",
                            }}
                        >
                            🎆🎂💐🥳🎇
                        </div>

                        <div
                            className="badge"
                            style={{
                                background: "linear-gradient(90deg, rgba(255,107,53,0.3), rgba(255,209,102,0.3))",
                                border: "1px solid #ffd166",
                                color: "#ffd166",
                                fontSize: "0.88rem",
                                fontWeight: 900,
                                padding: "7px 18px",
                                borderRadius: 999,
                                marginBottom: 16,
                                boxShadow: "0 0 20px rgba(255,209,102,0.35)",
                            }}
                        >
                            🎵 PLAYING HAPPY BIRTHDAY CELEBRATION SONG 🎵
                        </div>

                        <h1
                            style={{
                                fontSize: "2.65rem",
                                fontWeight: 900,
                                lineHeight: 1.2,
                                marginBottom: 14,
                                background: "linear-gradient(90deg, #fff 0%, #ffd166 45%, #ff6b35 80%, #ff9ff3 100%)",
                                WebkitBackgroundClip: "text",
                                WebkitTextFillColor: "transparent",
                                textShadow: "0 10px 30px rgba(255,159,67,0.35)",
                            }}
                        >
                            Happy Birthday, {birthdayOverlay.name}! 🌟🌸
                        </h1>

                        <p
                            style={{
                                fontSize: "1.14rem",
                                lineHeight: 1.65,
                                color: "#f8f9fa",
                                marginBottom: 24,
                                whiteSpace: "pre-line",
                                background: "rgba(255,255,255,0.05)",
                                padding: "16px 20px",
                                borderRadius: 16,
                                border: "1px solid rgba(255,255,255,0.1)",
                            }}
                        >
                            {birthdayOverlay.wish}
                        </p>

                        <div style={{ fontSize: "1.6rem", letterSpacing: 6, marginBottom: 22 }}>
                            🌸✨🎆🌺🌟🎇🌷🎊
                        </div>

                        <div className="flex gap-2" style={{ justifyContent: "center", flexWrap: "wrap" }}>
                            <button
                                className="btn btn-outline"
                                style={{
                                    borderColor: "#ffd166",
                                    color: "#ffd166",
                                    padding: "12px 22px",
                                    fontWeight: 800,
                                    borderRadius: 12,
                                }}
                                onClick={() => {
                                    if (stopMusicRef.current) stopMusicRef.current();
                                    stopMusicRef.current = playHappyBirthdayMelody();
                                    speakText(`Happy Birthday to you, ${birthdayOverlay.name}!`);
                                }}
                            >
                                🎵 Replay Song & Fireworks
                            </button>
                            <button
                                className="btn btn-primary"
                                style={{
                                    background: "linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)",
                                    padding: "12px 28px",
                                    fontWeight: 900,
                                    borderRadius: 12,
                                    boxShadow: "0 10px 25px rgba(255,107,53,0.45)",
                                }}
                                onClick={() => {
                                    if (stopMusicRef.current) stopMusicRef.current();
                                    setBirthdayOverlay(null);
                                }}
                            >
                                ✨ Thank You! Start Dining 🍽️
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════════
                MODAL E: CONSOLIDATED GST BILL & TABLE QR CODE PAYMENT (Requirement 7, 9, 10)
               ═══════════════════════════════════════════════════════════════════════ */}
            {showBillModal && (
                <div className="modal-overlay" onClick={() => setShowBillModal(false)}>
                    <div
                        className="card modal"
                        style={{ maxWidth: 780, width: "95%" }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center" style={{ marginBottom: 18 }}>
                            <div>
                                <h2 style={{ fontSize: "1.45rem", fontWeight: 800 }}>
                                    🧾 GST Tax Invoice & Table QR Payment
                                </h2>
                                <p className="text-muted text-sm">
                                    {sessionData.restaurant.name} ({sessionData.branch.name}) · Table T{sessionData.table.table_number} · Billed To: <strong style={{ color: "#ffd166" }}>{currentCustomerName}</strong>
                                    {sessionData.branch.gstin ? ` · GSTIN: ${sessionData.branch.gstin}` : ""}
                                </p>
                            </div>
                            <button className="btn btn-outline btn-sm" onClick={() => setShowBillModal(false)}>
                                ✕ Close
                            </button>
                        </div>

                        {activeOrders.length === 0 ? (
                            <p className="text-muted" style={{ padding: 24, textAlign: "center" }}>
                                No confirmed kitchen orders yet. Please place your cart order first!
                            </p>
                        ) : (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(295px, 1fr))", gap: 24 }}>
                                {/* LEFT: ITEMIZED GST BILL BREAKDOWN */}
                                <div
                                    style={{
                                        background: "var(--bg-base)",
                                        padding: 18,
                                        borderRadius: 12,
                                        border: "1px solid var(--border)",
                                    }}
                                >
                                    <h3 style={{ fontSize: "1rem", marginBottom: 12, color: "#ff6b35" }}>
                                        Ordered Items Summary
                                    </h3>
                                    <div style={{ maxHeight: 220, overflowY: "auto", marginBottom: 14 }}>
                                        {activeOrders.map((ord) =>
                                            ord.items.map((oi) => (
                                                <div
                                                    key={oi.id}
                                                    className="flex justify-between text-sm"
                                                    style={{ padding: "6px 0", borderBottom: "1px dashed var(--border)" }}
                                                >
                                                    <span>
                                                        {oi.name} <strong>×{oi.quantity}</strong>
                                                    </span>
                                                    <span>₹{Number(oi.line_total).toFixed(2)}</span>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                                        <div className="flex justify-between text-sm" style={{ marginBottom: 6 }}>
                                            <span className="text-muted">Subtotal (Taxable Value)</span>
                                            <span>₹{ordersSubtotal.toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm" style={{ marginBottom: 6 }}>
                                            <span className="text-muted">CGST (Central GST)</span>
                                            <span>₹{ordersCgst.toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm" style={{ marginBottom: 10 }}>
                                            <span className="text-muted">SGST (State GST)</span>
                                            <span>₹{ordersSgst.toFixed(2)}</span>
                                        </div>
                                        <div
                                            className="flex justify-between"
                                            style={{
                                                borderTop: "2px solid var(--border)",
                                                paddingTop: 10,
                                                fontSize: "1.28rem",
                                                fontWeight: 900,
                                                color: "var(--green)",
                                            }}
                                        >
                                            <span>Grand Total (incl. GST)</span>
                                            <span>₹{ordersGrandTotal.toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* RIGHT: SCANNABLE UPI QR CODE WITH CONFIGURABLE MERCHANT UPI ID */}
                                <div
                                    style={{
                                        background: "var(--bg-base)",
                                        padding: 18,
                                        borderRadius: 12,
                                        border: "1px solid var(--green)",
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        textAlign: "center",
                                    }}
                                >
                                    <div className="badge badge-ready" style={{ marginBottom: 8 }}>
                                        📱 SCAN & PAY AT TABLE (UPI QR)
                                    </div>
                                    <div
                                        style={{
                                            background: "#fff",
                                            padding: 14,
                                            borderRadius: 12,
                                            marginBottom: 10,
                                        }}
                                    >
                                        <QRCodeCanvas value={upiPayUri} size={175} level="H" includeMargin={true} />
                                    </div>

                                    <div style={{ fontWeight: 900, fontSize: "1.18rem", color: "var(--green)", marginBottom: 4 }}>
                                        Pay ₹{ordersGrandTotal.toFixed(2)}
                                    </div>

                                    {/* Locked Merchant UPI ID display (Read-only for security) */}
                                    <div className="text-muted" style={{ fontSize: "0.78rem", marginBottom: 12 }}>
                                        Merchant UPI ID: <strong style={{ color: "var(--text)" }}>{effectiveUpiId}</strong> 🔒
                                    </div>

                                    <input
                                        className="input"
                                        style={{ marginBottom: 10, fontSize: "0.82rem", padding: "8px 12px" }}
                                        placeholder="Optional UPI Ref / UTR Number"
                                        value={upiRefInput}
                                        onChange={(e) => setUpiRefInput(e.target.value)}
                                    />

                                    <button
                                        className="btn btn-success"
                                        style={{ width: "100%", justifyContent: "center", padding: "12px", fontWeight: 800 }}
                                        onClick={() =>
                                            handlePayViaTableQR(
                                                ordersGrandTotal,
                                                ordersSubtotal,
                                                ordersCgst,
                                                ordersSgst
                                            )
                                        }
                                        disabled={payingQR}
                                    >
                                        {payingQR
                                            ? "Verifying & Notifying Cashier…"
                                            : `✅ Payment Done (₹${ordersGrandTotal.toFixed(2)})`}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
