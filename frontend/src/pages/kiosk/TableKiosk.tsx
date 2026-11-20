import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import api, { WS_BASE_URL } from "../../api/client";
import { 
    getFoodFallbackSvg, 
    getFoodImage, 
    CARTOON_VIDEOS, 
    ORDER_STAGES, 
    playHappyBirthdayMelody 
} from "./kioskUtils";

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
    is_available?: boolean;
    image_url?: string | null;
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

export default function TableKiosk() {
    const navigate = useNavigate();
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

    // Admin Unlock Modal for unbinding/resetting table
    const [showAdminResetModal, setShowAdminResetModal] = useState<boolean>(false);
    const [adminPasswordInput, setAdminPasswordInput] = useState<string>("");
    const [adminResetError, setAdminResetError] = useState<string>("");
    const [verifyingAdminReset, setVerifyingAdminReset] = useState<boolean>(false);

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
    const [statusToast, setStatusToast] = useState<{
        id: string;
        icon: string;
        title: string;
        message: string;
        color: string;
        buttons?: { id: string; title: string }[];
    } | null>(null);
    const [aiPopupCard, setAiPopupCard] = useState<{
        id: string;
        title: string;
        body: string;
        buttons?: { id: string; title: string }[];
    } | null>(null);
    const [showAllCategoriesMenu, setShowAllCategoriesMenu] = useState<boolean>(false);
    const [markingDelivered, setMarkingDelivered] = useState<boolean>(false);
    const [showServedBillWidget, setShowServedBillWidget] = useState<boolean>(false);
    const toastTimeoutRef = useRef<any>(null);

    function triggerTopBannerToast(
        icon: string,
        title: string,
        message: string,
        color = "#23d18b",
        durationMs = 5500,
        buttons?: { id: string; title: string }[]
    ) {
        if (toastTimeoutRef.current) {
            clearTimeout(toastTimeoutRef.current);
        }
        const id = `toast-${Date.now()}`;
        setStatusToast({ id, icon, title, message, color, buttons });
        if (durationMs > 0) {
            toastTimeoutRef.current = setTimeout(() => {
                setStatusToast((curr) => (curr && curr.id === id ? null : curr));
            }, durationMs);
        }
    }

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
    const [inactivityCountdown, setInactivityCountdown] = useState<number | null>(null);
    const lastInteractionAtRef = useRef<number>(Date.now());
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
    const [isPointerLocked, setIsPointerLocked] = useState<boolean>(false);
    const [isVirtualCursorInteractive, setIsVirtualCursorInteractive] = useState<boolean>(false);
    const hasEnteredFullscreenOnceRef = useRef<boolean>(false);
    const adminUnlockedRef = useRef<boolean>(false);
    const virtualCursorRef = useRef<HTMLDivElement | null>(null);
    const virtualPosRef = useRef<{ x: number; y: number }>({
        x: typeof window !== "undefined" ? Math.round(window.innerWidth / 2) : 500,
        y: typeof window !== "undefined" ? Math.round(window.innerHeight / 2) : 350,
    });
    const isVirtualCursorInteractiveRef = useRef<boolean>(false);

    const isStandalonePwa =
        typeof window !== "undefined" &&
        (window.matchMedia?.("(display-mode: fullscreen)")?.matches ||
            window.matchMedia?.("(display-mode: standalone)")?.matches ||
            Boolean((window.navigator as any).standalone));

    const isFullscreenSupported =
        typeof document !== "undefined" &&
        Boolean((document as any).fullscreenEnabled || (document as any).webkitFullscreenEnabled || (document as any).msFullscreenEnabled);

    function enterKioskPointerLock() {
        try {
            if (adminUnlockedRef.current || isStandalonePwa) return;
            const doc = document as any;
            const isFs = Boolean(doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement);
            if (!isFs) return;
            if (doc.pointerLockElement || doc.webkitPointerLockElement) return;
            const docEl = document.documentElement as any;
            if (docEl.requestPointerLock) {
                const res = docEl.requestPointerLock();
                if (res && typeof res.catch === "function") {
                    res.catch(() => { });
                }
            } else if (docEl.webkitRequestPointerLock) {
                docEl.webkitRequestPointerLock();
            }
        } catch {
            // ignore pointer lock restrictions on touch-only browsers
        }
    }

    function exitKioskPointerLock() {
        try {
            const doc = document as any;
            if (doc.pointerLockElement && doc.exitPointerLock) {
                doc.exitPointerLock();
            } else if (doc.webkitPointerLockElement && doc.webkitExitPointerLock) {
                doc.webkitExitPointerLock();
            }
        } catch {
            // ignore
        }
    }

    function enterKioskFullscreen() {
        try {
            const doc = document as any;
            if (doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement) {
                hasEnteredFullscreenOnceRef.current = true;
                enterKioskPointerLock();
                return;
            }
            const docEl = document.documentElement as any;
            if (docEl.requestFullscreen) {
                Promise.resolve(docEl.requestFullscreen({ navigationUI: "hide" }))
                    .then(() => {
                        hasEnteredFullscreenOnceRef.current = true;
                        enterKioskPointerLock();
                        try {
                            (navigator as any).keyboard?.lock?.(["Escape", "F11"])?.catch?.(() => { });
                        } catch { }
                    })
                    .catch(() => { });
            } else if (docEl.webkitRequestFullscreen) {
                docEl.webkitRequestFullscreen();
                hasEnteredFullscreenOnceRef.current = true;
                enterKioskPointerLock();
            } else if (docEl.msRequestFullscreen) {
                docEl.msRequestFullscreen();
                hasEnteredFullscreenOnceRef.current = true;
            }
        } catch {
            // ignore fullscreen restrictions
        }
    }

    function exitKioskFullscreen() {
        exitKioskPointerLock();
        try {
            const doc = document as any;
            if (doc.fullscreenElement && doc.exitFullscreen) {
                Promise.resolve(doc.exitFullscreen()).catch(() => { });
            } else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
                doc.webkitExitFullscreen();
            } else if (doc.msFullscreenElement && doc.msExitFullscreen) {
                doc.msExitFullscreen();
            }
        } catch {
            // ignore
        }
    }

    useEffect(() => {
        const updateFullscreenState = () => {
            const doc = document as any;
            const active = Boolean(doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement);
            if (active) {
                hasEnteredFullscreenOnceRef.current = true;
            }
            setIsFullscreen(active);
        };
        const updatePointerLockState = () => {
            const doc = document as any;
            const locked = Boolean(doc.pointerLockElement || doc.webkitPointerLockElement);
            setIsPointerLocked(locked);
        };
        updateFullscreenState();
        updatePointerLockState();
        document.addEventListener("fullscreenchange", updateFullscreenState);
        document.addEventListener("webkitfullscreenchange", updateFullscreenState);
        document.addEventListener("pointerlockchange", updatePointerLockState);
        document.addEventListener("webkitpointerlockchange", updatePointerLockState);
        return () => {
            document.removeEventListener("fullscreenchange", updateFullscreenState);
            document.removeEventListener("webkitfullscreenchange", updateFullscreenState);
            document.removeEventListener("pointerlockchange", updatePointerLockState);
            document.removeEventListener("webkitpointerlockchange", updatePointerLockState);
        };
    }, []);

    useEffect(() => {
        const isBound = Boolean(activeToken || selectedTableId);
        if (!isBound) return;

        if (!showAdminResetModal && !adminUnlockedRef.current) {
            enterKioskFullscreen();
        }

        const handleFirstGesture = (e: Event) => {
            if (adminUnlockedRef.current) return;
            const ptr = e as PointerEvent;
            if (ptr.pointerType === "touch") {
                virtualPosRef.current = {
                    x: Math.min(window.innerWidth - 4, Math.max(4, ptr.clientX || virtualPosRef.current.x)),
                    y: Math.min(window.innerHeight - 4, Math.max(4, ptr.clientY || virtualPosRef.current.y)),
                };
            }
            const doc = document as any;
            if (!doc.fullscreenElement && !doc.webkitFullscreenElement && !doc.msFullscreenElement) {
                if (!showAdminResetModal) enterKioskFullscreen();
            } else if (!doc.pointerLockElement && !doc.webkitPointerLockElement && ptr.pointerType !== "touch") {
                enterKioskPointerLock();
            }
        };

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (adminUnlockedRef.current) return;
            e.preventDefault();
            e.returnValue = "Kiosk is locked by Admin.";
        };

        window.history.pushState({ kioskLocked: true }, "", window.location.href);
        const handlePopState = () => {
            if (adminUnlockedRef.current) return;
            window.history.pushState({ kioskLocked: true }, "", window.location.href);
            enterKioskFullscreen();
            setAdminResetError("");
            setAdminPasswordInput("");
            setShowAdminResetModal(true);
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (adminUnlockedRef.current) return;
            const k = (e.key || "").toLowerCase();
            const isCloseOrNavCombo =
                k === "escape" ||
                k === "f11" ||
                ((e.ctrlKey || e.metaKey) && ["w", "t", "n", "l", "r"].includes(k)) ||
                (e.altKey && (k === "f4" || k === "arrowleft" || k === "arrowright"));
            if (isCloseOrNavCombo) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        const handleContextMenu = (e: MouseEvent) => {
            if (!adminUnlockedRef.current) {
                e.preventDefault();
            }
        };

        document.addEventListener("pointerdown", handleFirstGesture, true);
        document.addEventListener("click", handleFirstGesture, true);
        window.addEventListener("beforeunload", handleBeforeUnload);
        window.addEventListener("popstate", handlePopState);
        window.addEventListener("keydown", handleKeyDown, true);
        document.addEventListener("contextmenu", handleContextMenu);

        return () => {
            document.removeEventListener("pointerdown", handleFirstGesture, true);
            document.removeEventListener("click", handleFirstGesture, true);
            window.removeEventListener("beforeunload", handleBeforeUnload);
            window.removeEventListener("popstate", handlePopState);
            window.removeEventListener("keydown", handleKeyDown, true);
            document.removeEventListener("contextmenu", handleContextMenu);
        };
    }, [activeToken, selectedTableId, showAdminResetModal]);

    useEffect(() => {
        if (!isPointerLocked) return;

        const updateCursorEl = (x: number, y: number) => {
            if (virtualCursorRef.current) {
                virtualCursorRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            }
            const el = document.elementFromPoint(x, y) as HTMLElement | null;
            const interactive = Boolean(
                el?.closest("button, a, input, textarea, label, [role='button']")
            );
            if (interactive !== isVirtualCursorInteractiveRef.current) {
                isVirtualCursorInteractiveRef.current = interactive;
                setIsVirtualCursorInteractive(interactive);
            }
        };

        updateCursorEl(virtualPosRef.current.x, virtualPosRef.current.y);

        const handleMouseMove = (e: MouseEvent) => {
            const nx = Math.min(window.innerWidth - 4, Math.max(4, virtualPosRef.current.x + e.movementX));
            const ny = Math.min(window.innerHeight - 4, Math.max(4, virtualPosRef.current.y + e.movementY));
            virtualPosRef.current = { x: nx, y: ny };
            updateCursorEl(nx, ny);
        };

        const handleMouseDown = (e: MouseEvent) => {
            if (!e.isTrusted || e.button !== 0) return;
            const { x, y } = virtualPosRef.current;
            const target = document.elementFromPoint(x, y) as HTMLElement | null;
            if (!target) return;
            const inputEl = target.closest("input, textarea") as HTMLElement | null;
            if (inputEl) {
                inputEl.focus();
            }
        };

        const handleMouseUp = (e: MouseEvent) => {
            if (!e.isTrusted || e.button !== 0) return;
            const { x, y } = virtualPosRef.current;
            const target = document.elementFromPoint(x, y) as HTMLElement | null;
            if (!target) return;
            const actionable = (target.closest("button, a, input, textarea, label, [role='button']") as HTMLElement) || target;
            if (
                (actionable.tagName === "INPUT" &&
                    !["checkbox", "radio", "submit", "button"].includes((actionable as HTMLInputElement).type)) ||
                actionable.tagName === "TEXTAREA"
            ) {
                actionable.focus();
            } else {
                actionable.click();
            }
        };

        const handleWheel = (e: WheelEvent) => {
            const { x, y } = virtualPosRef.current;
            let el = document.elementFromPoint(x, y) as HTMLElement | null;
            while (el && el !== document.documentElement) {
                const style = window.getComputedStyle(el);
                const canScrollY =
                    (style.overflowY === "auto" || style.overflowY === "scroll") &&
                    el.scrollHeight > el.clientHeight;
                const canScrollX =
                    (style.overflowX === "auto" || style.overflowX === "scroll") &&
                    el.scrollWidth > el.clientWidth;
                if (canScrollY || canScrollX) {
                    el.scrollBy({ top: e.deltaY, left: e.deltaX });
                    break;
                }
                el = el.parentElement;
            }
        };

        document.addEventListener("mousemove", handleMouseMove, true);
        document.addEventListener("mousedown", handleMouseDown, true);
        document.addEventListener("mouseup", handleMouseUp, true);
        document.addEventListener("wheel", handleWheel, { passive: true, capture: true });

        return () => {
            document.removeEventListener("mousemove", handleMouseMove, true);
            document.removeEventListener("mousedown", handleMouseDown, true);
            document.removeEventListener("mouseup", handleMouseUp, true);
            document.removeEventListener("wheel", handleWheel, true);
        };
    }, [isPointerLocked]);

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

    // Kiosk Language Mode: "auto" (detect based on customer speech) | "en" | "hi" | "or"
    const [kioskLanguage, setKioskLanguage] = useState<"auto" | "en" | "hi" | "or">("auto");

    // Dynamic Voice Picker: Finds the most authentic natural human voice for the target language (English, Hindi, Odia)
    // Harmonized persona: warm, professional female Indian AI assistant across both Desktop and Mobile/Android.
    function pickVoiceForLanguage(targetLang: "en" | "hi" | "or"): SpeechSynthesisVoice | null {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
        const voices = window.speechSynthesis.getVoices() || [];
        if (voices.length === 0) return null;

        // Preferred female Indian natural voice signatures (matching gender & accent across OS platforms)
        const femaleIndianPreferred = [
            "microsoft neerja online (natural)",
            "microsoft swara online (natural)",
            "google हिन्दी",
            "google hindi",
            "google english (india)",
            "google en-in",
            "neerja",
            "swara",
            "veena",
            "lekha",
            "sangeeta",
            "kavya",
            "en-in-x-end-network",
            "en-in-x-ene-local",
            "hi-in-x-hie-local",
            "hi-in-x-hie-network",
        ];

        if (targetLang === "hi") {
            // Hindi natural / neural voices
            const hindiVoices = [
                "microsoft swara online (natural)",
                "google हिन्दी",
                "google hindi",
                "swara",
                "hi-in-x-hie-network",
                "hi-in-x-hie-local",
                "hi-in",
                "hi_in",
                "microsoft madhur online (natural)",
                "madhur",
            ];
            for (const target of hindiVoices) {
                const match = voices.find(
                    (v) =>
                        v.name.toLowerCase().includes(target) ||
                        (v.lang || "").toLowerCase().replace(/_/g, "-").startsWith("hi")
                );
                if (match) return match;
            }
        } else if (targetLang === "or") {
            // Check if tablet has an authentic Odia voice engine installed
            const odiaMatch = voices.find(
                (v) =>
                    v.name.toLowerCase().includes("odia") ||
                    v.name.toLowerCase().includes("oriya") ||
                    (v.lang || "").toLowerCase().replace(/_/g, "-").startsWith("or")
            );
            if (odiaMatch) return odiaMatch;

            // If device lacks native Odia TTS, use highest quality Indian voice
            // which can cleanly pronounce phonetic regional words without muting
            for (const target of femaleIndianPreferred) {
                const match = voices.find((v) => v.name.toLowerCase().includes(target));
                if (match) return match;
            }
            const indianFallback = voices.find(
                (v) =>
                    (v.lang || "").toLowerCase().includes("in") &&
                    (v.name.toLowerCase().includes("female") || v.name.toLowerCase().includes("google") || v.name.toLowerCase().includes("natural"))
            );
            if (indianFallback) return indianFallback;
        }

        // Default / English (India) — enforce Indian female natural voice first
        for (const target of femaleIndianPreferred) {
            const match = voices.find(
                (v) =>
                    v.name.toLowerCase().includes(target) &&
                    (v.lang.toLowerCase().replace(/_/g, "-").startsWith("en") || !v.lang)
            );
            if (match) return match;
        }

        const enInStrictFemale = voices.find((v) => {
            const l = (v.lang || "").toLowerCase().replace(/_/g, "-");
            const n = v.name.toLowerCase();
            return (l === "en-in" || l.startsWith("en-in")) && (n.includes("female") || n.includes("woman") || n.includes("neerja") || n.includes("swara") || n.includes("veena"));
        });
        if (enInStrictFemale) return enInStrictFemale;

        const enInStrict = voices.find((v) => {
            const l = (v.lang || "").toLowerCase().replace(/_/g, "-");
            return l === "en-in" || l.startsWith("en-in");
        });
        if (enInStrict) return enInStrict;

        const anyEnglish = voices.find((v) => {
            const l = (v.lang || "").toLowerCase().replace(/_/g, "-");
            return l.startsWith("en-") || l === "en";
        });
        return anyEnglish || voices.find((v) => v.default) || voices[0];
    }

    // Convert native Odia script into clear Romanized phonetic text so browser Indian TTS can speak it fluently
    function transliterateOdiaToPhonetic(odiaText: string): string {
        const odiaToRoman: Record<string, string> = {
            "ଅ": "a", "ଆ": "aa", "ଇ": "i", "ଈ": "ee", "ଉ": "u", "ଊ": "oo", "ଋ": "ri",
            "ଏ": "e", "ଐ": "ai", "ଓ": "o", "ଔ": "au",
            "କ": "ka", "ଖ": "kha", "ଗ": "ga", "ଘ": "gha", "ଙ": "nga",
            "ଚ": "cha", "ଛ": "chha", "ଜ": "ja", "ଝ": "jha", "ଞ": "nya",
            "ଟ": "ta", "ଠ": "tha", "ଡ": "da", "ଢ": "dha", "ଣ": "na",
            "ତ": "ta", "ଥ": "tha", "ଦ": "da", "ଧ": "dha", "ନ": "na",
            "ପ": "pa", "ଫ": "pha", "ବ": "ba", "ଭ": "bha", "ମ": "ma",
            "ଯ": "ya", "ୟ": "ya", "ର": "ra", "ଲ": "la", "ଳ": "la", "ଵ": "va",
            "ଶ": "sha", "ଷ": "sha", "ସ": "sa", "ହ": "ha",
            "ା": "aa", "ି": "i", "ୀ": "ee", "ୁ": "u", "ୂ": "oo", "ୃ": "ri",
            "େ": "e", "ୈ": "ai", "ୋ": "o", "ୌ": "au", "୍": "",
            "ଂ": "ng", "ଃ": "h", "ଁ": "n",
            "୦": "0", "୧": "1", "୨": "2", "୩": "3", "୪": "4", "୫": "5", "୬": "6", "୭": "7", "୮": "8", "୯": "9"
        };

        // If no Odia characters, return as is
        if (!/[\u0B00-\u0B7F]/.test(odiaText)) return odiaText;

        let result = "";
        for (let i = 0; i < odiaText.length; i++) {
            const char = odiaText[i];
            if (odiaToRoman[char] !== undefined) {
                result += odiaToRoman[char];
            } else {
                result += char;
            }
        }
        return result.replace(/\s+/g, " ").trim();
    }

    // Speak text using Browser SpeechSynthesis with language-specific pronunciation and natural cadence
    function speakText(rawText: string, targetLanguage?: "en" | "hi" | "or") {
        if (!voiceEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
        try {
            window.speechSynthesis.cancel();
            let clean = rawText
                .replace(/[*_~`#]/g, "")
                .replace(/─+/g, "")
                .replace(/₹\s*(\d+)/g, "Rupees $1")
                .replace(/×\s*(\d+)/g, "quantity $1")
                .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
                .replace(/\s+/g, " ")
                .trim();
            if (!clean) return;

            // Auto-detect language if not explicitly given
            let detectedLang: "en" | "hi" | "or" = targetLanguage || "en";
            if (!targetLanguage) {
                const odiaChars = (clean.match(/[\u0B00-\u0B7F]/g) || []).length;
                const hindiChars = (clean.match(/[\u0900-\u097F]/g) || []).length;
                if (odiaChars >= 2) detectedLang = "or";
                else if (hindiChars >= 2) detectedLang = "hi";
                else detectedLang = "en";
            }

            const chosenVoice = pickVoiceForLanguage(detectedLang);
            const hasNativeOdiaVoice = chosenVoice && (
                chosenVoice.name.toLowerCase().includes("odia") ||
                chosenVoice.name.toLowerCase().includes("oriya") ||
                (chosenVoice.lang || "").toLowerCase().startsWith("or")
            );

            // If speaking Odia on a device without a native Odia TTS voice pack (most Windows & Android devices),
            // transliterate into phonetic Romanized text so the Indian English/Hindi voice speaks Odia words cleanly!
            if (detectedLang === "or" && !hasNativeOdiaVoice) {
                clean = transliterateOdiaToPhonetic(clean);
            }

            const utterance = new SpeechSynthesisUtterance(clean);
            if (chosenVoice) {
                utterance.voice = chosenVoice;
                utterance.lang = chosenVoice.lang || (detectedLang === "hi" ? "hi-IN" : "en-IN");
            } else {
                utterance.lang = detectedLang === "hi" ? "hi-IN" : "en-IN";
            }

            // Warm, natural conversational cadence harmonized across Desktop & Mobile
            utterance.rate = detectedLang === "hi" || detectedLang === "or" ? 0.92 : 0.96;
            utterance.pitch = 1.05; // Slightly elevated pitch for a friendly, natural feminine tone
            utterance.volume = 1.0;

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
        customVoiceText?: string,
        replyLanguage?: "en" | "hi" | "or"
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
            speakText(customVoiceText || body, replyLanguage);
        }
    }

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, botThinking]);

    function loadAvailableTables() {
        setLoading(true);
        setError("");
        api.get("/kiosk/tables-list")
            .then((res) => {
                setAvailableBranches(res.data);
                if (res.data.length === 0) {
                    const loggedStaff = localStorage.getItem("hd_token");
                    if (!loggedStaff) {
                        setError("To bind this tablet to a table, please log in with your Restaurant Admin or Staff account first.");
                    }
                }
            })
            .catch(() =>
                setError(
                    "Could not connect to Backend API. Please check your internet connection or backend service."
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

    const startingSessionInFlightRef = useRef<boolean>(false);
    const lastSessionLoadedAtRef = useRef<number>(0);

    async function startOrResumeSession(tok?: string, tblId?: string, forceNew = false) {
        if (startingSessionInFlightRef.current && !forceNew) {
            return;
        }
        startingSessionInFlightRef.current = true;
        if (forceNew && sessionData) {
            sessionStorage.removeItem("hd_kiosk_checkedin_session");
            setCheckedInSessionId("");
            setWelcomeName("");
            setWelcomeDob("");
            setWelcomeIsBirthday(false);
            setGoodbyeScreen(null);
            setShowBillModal(false);
            setShowOrderConfirmModal(false);
            setShowCartRemoveModal(false);
            setJokeBanner(null);
            setAiPopupCard(null);
            setShowServedBillWidget(false);
            setShowAllCategoriesMenu(false);
            setShowBirthdayPrompt(false);
            setSearchQuery("");
            setSelectedCategory("ALL");
            setVegFilter("ALL");
            setBestsellerOnly(false);
            setAiMatchedItemIds(null);
            setInactivityCountdown(null);
            lastInteractionAtRef.current = Date.now();
        } else {
            setLoading(true);
        }
        setError("");
        try {
            const payload: any = { force_new: forceNew };
            if (tok) payload.token = tok;
            else if (tblId) payload.table_id = tblId;

            const res = await api.post("/kiosk/session/start", payload);
            lastSessionLoadedAtRef.current = Date.now();
            setSessionData(res.data);
            if (res.data?.orders) {
                seedOrderStatuses(res.data.orders);
            }
            setGoodbyeScreen(null);
            setShowBillModal(false);
            setShowOrderConfirmModal(false);
            setShowCartRemoveModal(false);
            setJokeBanner(null);
            setAiPopupCard(null);
            setShowServedBillWidget(false);
            setShowAllCategoriesMenu(false);
            setShowBirthdayPrompt(false);
            setSearchQuery("");
            setSelectedCategory("ALL");
            setVegFilter("ALL");
            setBestsellerOnly(false);
            setAiMatchedItemIds(null);
            setInactivityCountdown(null);
            lastInteractionAtRef.current = Date.now();

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
            startingSessionInFlightRef.current = false;
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
    const cartMutationChainRef = useRef<Promise<any>>(Promise.resolve());

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
        const statusLabels: Record<string, { text: string; voice: string; icon: string; title: string; color: string }> = {
            ACCEPTED: {
                text: `✅ *Kitchen Update*: Your order *#${orderNumber}* has been *ACCEPTED* by the kitchen!`,
                voice: `Good news! The kitchen has accepted your order number ${orderNumber}.`,
                icon: "✅",
                title: "Order Accepted by Kitchen!",
                color: "#23d18b",
            },
            PREPARING: {
                text: `👨‍🍳 *Kitchen Update*: Our chef is now freshly *PREPARING* your order *#${orderNumber}*!`,
                voice: `Our chef is now freshly preparing your order number ${orderNumber}.`,
                icon: "👨‍🍳",
                title: "Chef is Preparing Your Food!",
                color: "#f59e0b",
            },
            READY: {
                text: `🔔 *Order is on the way to your table!* Your order *#${orderNumber}* is hot and ready, and our waiter is bringing it to your table right now!`,
                voice: `Great news! Your order number ${orderNumber} is ready and on the way to your table!`,
                icon: "🛎️",
                title: "Order is on the Way to Your Table!",
                color: "#6366f1",
            },
            SERVED: {
                text: `🍽️ *Order Delivered & Served*: Your order *#${orderNumber}* has been served at your table. Enjoy your delicious meal! 😋`,
                voice: `Order number ${orderNumber} has been served at your table. Enjoy your meal! Whenever you are ready, you can scan the QR code to pay your bill.`,
                icon: "🍽️",
                title: "Order Delivered — Enjoy Your Meal!",
                color: "#23d18b",
            },
            CANCELLED: {
                text: `⚠️ *Order #${orderNumber}*: The item is not available or finished, please order other item, we are sorry for this.`,
                voice: `Sorry, order number ${orderNumber} was cancelled because the item is not available or finished. Please order another item.`,
                icon: "⚠️",
                title: "Order Cancelled / Item Unavailable",
                color: "#ef4444",
            },
        };
        const info = statusLabels[newStatus];
        if (info) {
            appendBotMessage(info.text, [{ id: "order_status", title: "👨‍🍳 Check Order Status" }], true, info.voice);
            triggerTopBannerToast(
                info.icon,
                `${info.title} — Order #${orderNumber}`,
                info.voice,
                info.color,
                6500
            );
            if (newStatus === "SERVED") {
                setShowServedBillWidget(true);
            }
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

        let isUnmounted = false;
        let reconnectTimeout: any = null;
        let tableWs: WebSocket | null = null;
        let hasConnectedOnce = false;
        const wsUrl = `${WS_BASE_URL}/orders/ws/table/${sessionId}`;

        function connectTableWs() {
            if (isUnmounted) return;
            const ws = new WebSocket(wsUrl);
            tableWs = ws;

            ws.onopen = () => {
                // Only refresh on reconnects or if initial load was >3s ago, avoiding redundant GET right after /session/start
                if (hasConnectedOnce || Date.now() - lastSessionLoadedAtRef.current > 3000) {
                    refreshSessionState(sessionId);
                }
                hasConnectedOnce = true;
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.event === "ORDER_STATUS_UPDATED") {
                        if (data.order_id && data.status) {
                            announceOrderStatusIfNeeded(data.order_id, data.order_number, data.status);
                        }
                        refreshSessionState(sessionId);
                    } else if (data.event === "ITEM_REJECTED") {
                        const itemName = data.item_name || "Item";
                        const ordNum = data.order_number || "";
                        const msgText = `⚠️ *Order #${ordNum}*: *${itemName}* is not available or finished, please order other item, we are sorry for this.`;
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: `item-rej-${Date.now()}`,
                                sender: "bot",
                                text: msgText,
                                time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                            },
                        ]);
                        speakText(`Sorry, ${itemName} in order number ${ordNum} is not available or finished. Please order another item.`);
                        triggerTopBannerToast(
                            "⚠️",
                            `Item Unavailable — Order #${ordNum}`,
                            `"${itemName}" is not available or finished. Please order another item.`,
                            "#ef4444",
                            7000
                        );
                        refreshSessionState(sessionId);
                    } else if (data.event === "SESSION_PAID_AND_EXPIRED") {
                        triggerGoodbyeFlow(
                            data.bill_number || "PAID",
                            Number(data.amount || 0),
                            Number(data.subtotal || 0),
                            Number(data.cgst_amount || 0),
                            Number(data.sgst_amount || 0),
                            data.message || "Thank you for dining with us! Your payment is complete."
                        );
                    }
                } catch {
                    // ignore
                }
            };

            ws.onclose = () => {
                if (!isUnmounted) {
                    reconnectTimeout = setTimeout(connectTableWs, 3000);
                }
            };

            ws.onerror = () => {
                ws.close();
            };
        }

        connectTableWs();

        // Smart WebSocket Fallback: only poll if tablet WebSocket is NOT currently open
        const poll = setInterval(() => {
            if (!tableWs || tableWs.readyState !== WebSocket.OPEN) {
                refreshSessionState(sessionId);
            }
        }, 15000);

        return () => {
            isUnmounted = true;
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            clearInterval(poll);
            if (tableWs) tableWs.close();
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
        setAiPopupCard(null);
        setShowServedBillWidget(false);
        setShowAllCategoriesMenu(false);
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
        const cleanName = welcomeName.trim();
        if (!cleanName) return;
        enterKioskFullscreen();
        setCheckingIn(true);
        try {
            const res = await api.post(`/kiosk/session/${sessId}/checkin`, {
                customer_name: cleanName,
                customer_dob: null,
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
        if (
            norm === "do_confirm" ||
            norm === "confirm_order" ||
            norm === "confirm order" ||
            norm === "confirm" ||
            norm === "place order" ||
            norm === "place my order" ||
            norm === "place the order" ||
            norm === "send to kitchen" ||
            norm === "send order to kitchen"
        ) {
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
            // Wait for any in-flight optimistic cart mutations (+ ADD / quantity changes) to finish saving in DB first
            // so the AI bot sees 100% of added items and never gets blocked by cartBusy!
            if (cartMutationCountRef.current > 0) {
                try {
                    await cartMutationChainRef.current;
                } catch {}
            }
            const chatStartedAt = Date.now();
            const res = await api.post("/kiosk/chat", {
                session_id: sessionData.session.id,
                message: messageText,
            });

            if (res.data.state) {
                const isOrderPlaced =
                    res.data.ui_action?.action === "ORDER_PLACED" ||
                    res.data.intent === "PLACE_ORDER" ||
                    res.data.intent === "CONFIRM";
                if (isOrderPlaced) {
                    cartMutationCountRef.current = 0;
                    lastCartMutationTimeRef.current = 0;
                    setShowOrderConfirmModal(false);
                }
                setSessionData((prev: any) => {
                    if (!prev) return res.data.state;
                    const cartBusy =
                        !isOrderPlaced &&
                        (cartMutationCountRef.current > 0 || lastCartMutationTimeRef.current > chatStartedAt);
                    return {
                        ...prev,
                        ...res.data.state,
                        restaurant: res.data.state.restaurant || prev.restaurant,
                        branch: res.data.state.branch || prev.branch,
                        categories: res.data.state.categories || prev.categories,
                        menu_items: res.data.state.menu_items || prev.menu_items,
                        cart: isOrderPlaced
                            ? { id: null, subtotal: 0, cgst_amount: 0, sgst_amount: 0, total: 0, items: [] }
                            : cartBusy
                            ? prev.cart
                            : res.data.state.cart,
                    };
                });
            }

            const reply = res.data.reply;
            const uiAction = res.data.ui_action;
            const intentName = res.data.intent || "";
            const resLang = (res.data.language || "en") as "en" | "hi" | "or";

            // Requirement 9: If showing bill/invoice, do NOT read all line items aloud — only speak short prompt
            let voiceOverride: string | undefined = reply?.voice_text;
            if (uiAction?.action === "SHOW_BILL") {
                if (resLang === "hi") {
                    voiceOverride = "कृपया स्क्रीन पर अपना बिल देखें और भुगतान के लिए क्यूआर कोड स्कैन करें।";
                } else if (resLang === "or") {
                    voiceOverride = "ଦୟାକରି ସ୍କ୍ରିନରେ ଆପଣଙ୍କ ବିଲ୍ ଦେଖନ୍ତୁ ଏବଂ ପେମେଣ୍ଟ ପାଇଁ QR କୋଡ୍ ସ୍କାନ୍ କରନ୍ତୁ।";
                } else {
                    voiceOverride = "Please review your invoice details on the screen and scan the QR code for payment.";
                }
            }

            if (reply?.body) {
                appendBotMessage(reply.body, reply.buttons, shouldSpeakReply, voiceOverride, resLang);

                // Show relevant bot response on the main screen via Top Toast Banner and/or AI Popup Card
                const cleanPlainBody = reply.body.replace(/[*_`~]/g, "").trim();
                const shortToastMsg = voiceOverride || cleanPlainBody.split("\n")[0] || cleanPlainBody;

                if (intentName === "ADD_ITEM" || intentName === "AI_PICK_AND_ADD" || intentName === "UPDATE_QTY" || intentName === "REMOVE_ITEM" || intentName === "CLEAR_CART") {
                    triggerTopBannerToast(
                        "🛒",
                        intentName === "REMOVE_ITEM" || intentName === "CLEAR_CART" ? "Cart Updated" : "Added to Cart!",
                        shortToastMsg,
                        "#23d18b",
                        6000,
                        reply.buttons
                    );
                    setAiPopupCard({
                        id: `ai-${Date.now()}`,
                        title: "🛒 AI Waiter — Cart Update",
                        body: cleanPlainBody,
                        buttons: reply.buttons,
                    });
                } else if (intentName === "CART_VIEW" || intentName === "ORDER_STATUS" || intentName === "CANCEL_ORDER") {
                    triggerTopBannerToast(
                        "📋",
                        intentName === "ORDER_STATUS" ? "Live Kitchen Order Status" : "Your Cart Summary",
                        shortToastMsg,
                        "#54a0ff",
                        6000
                    );
                    setAiPopupCard({
                        id: `ai-${Date.now()}`,
                        title: intentName === "ORDER_STATUS" ? "👨‍🍳 Live Order Status" : "🛒 Your Cart Details",
                        body: cleanPlainBody,
                        buttons: reply.buttons,
                    });
                } else if (intentName === "RECOMMEND_BEST" || intentName === "BROWSE") {
                    triggerTopBannerToast(
                        "⭐",
                        intentName === "RECOMMEND_BEST" ? "Chef's Top Recommendations" : "Menu Filtered for You",
                        shortToastMsg,
                        "#f9ca24",
                        6000
                    );
                    if (intentName === "RECOMMEND_BEST") {
                        setAiPopupCard({
                            id: `ai-${Date.now()}`,
                            title: "👨‍🍳 Chef's Top Recommendations",
                            body: cleanPlainBody,
                            buttons: reply.buttons,
                        });
                    }
                } else if (uiAction?.action === "SHOW_JOKE" && uiAction.joke) {
                    setJokeBanner(uiAction.joke);
                    triggerTopBannerToast("😂", "AI Waiter Joke!", uiAction.joke, "#f9ca24", 7500);
                } else if (uiAction?.action !== "SHOW_CARTOONS" && uiAction?.action !== "SHOW_BIRTHDAY" && uiAction?.action !== "SHOW_BILL") {
                    triggerTopBannerToast("🤖", "AI Waiter Response", shortToastMsg, "#ff6b35", 6500, reply.buttons);
                    setAiPopupCard({
                        id: `ai-${Date.now()}`,
                        title: "🤖 HelloDine AI Waiter",
                        body: cleanPlainBody,
                        buttons: reply.buttons,
                    });
                }
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
        // Set speech recognition language based on selected language
        // Note: For Odia (or), many Android browsers lack local or-IN speech models;
        // setting lang to 'or-IN' with fallback to 'hi-IN' ensures Google acoustic recognition can transcribe Indian syllables cleanly.
        if (kioskLanguage === "hi") {
            recognition.lang = "hi-IN";
        } else if (kioskLanguage === "or") {
            // Check if browser/OS supports or-IN speech recognition, else use hi-IN/en-IN which transcribes phonetic Indian speech
            recognition.lang = "or-IN";
        } else {
            // "en" or "auto": en-IN recognizer handles English, Hinglish, and Indian dish phonetics cleanly
            recognition.lang = "en-IN";
        }
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
    function recalculateOptimisticCart(items: CartItem[], baseCart?: any) {
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
            ...(baseCart || sessionData?.cart || {}),
            items,
            subtotal: Math.round(subtotal * 100) / 100,
            cgst_amount: Math.round(cgst * 100) / 100,
            sgst_amount: Math.round(sgst * 100) / 100,
            total,
        };
    }

    async function handleAddItem(item: MenuItem) {
        if (!sessionData?.session?.id) return;
        const sessId = sessionData.session.id;

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
                cart: recalculateOptimisticCart(currentItems, prev.cart),
            };
        });
        triggerTopBannerToast(
            "🛒",
            `Added ${item.name} to Cart`,
            `₹${Number(item.base_price).toFixed(0)} · Tap Place Order when ready or speak to AI Waiter below!`,
            "#23d18b",
            3200
        );

        // 2. Sync to DB in sequential queue so two rapid adds across categories never race on the backend
        const task = cartMutationChainRef.current.then(async () => {
            try {
                const res = await api.post("/cart/add", {
                    session_id: sessId,
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
        });
        cartMutationChainRef.current = task.catch(() => {});
        await task;
    }

    async function handleUpdateCartQty(cartItem: CartItem, newQty: number) {
        if (!sessionData?.session?.id) return;
        const sessId = sessionData.session.id;

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
                cart: recalculateOptimisticCart(currentItems, prev.cart),
            };
        });

        // 2. Sync to DB in sequential queue
        const task = cartMutationChainRef.current.then(async () => {
            try {
                if (String(cartItem.id).startsWith("temp-")) {
                    const delta = newQty - cartItem.quantity;
                    if (delta > 0) {
                        const res = await api.post("/cart/add", {
                            session_id: sessId,
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
        });
        cartMutationChainRef.current = task.catch(() => {});
        await task;
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
                cart: recalculateOptimisticCart(currentItems, prev.cart),
            };
        });

        const task = cartMutationChainRef.current.then(async () => {
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
        });
        cartMutationChainRef.current = task.catch(() => {});
        await task;
    }

    // Clear all items in the cart atomically in 1 backend SQL DELETE with zero flicker
    async function handleClearAllCartItems() {
        if (!sessionData?.session?.id) return;
        const sessId = sessionData.session.id;

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

        const task = cartMutationChainRef.current.then(async () => {
            try {
                const res = await api.delete(`/cart/${sessId}/clear`);
                lastCartMutationTimeRef.current = Date.now();
                if (res.data?.cart && cartMutationCountRef.current <= 1) {
                    setSessionData((prev: any) => (prev ? { ...prev, cart: res.data.cart } : prev));
                }
            } catch {
                refreshSessionState(undefined, true);
            } finally {
                cartMutationCountRef.current = Math.max(0, cartMutationCountRef.current - 1);
            }
        });
        cartMutationChainRef.current = task.catch(() => {});
        await task;
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
            // Wait for any in-flight optimistic cart mutations (+ ADD / quantity changes) to finish saving in DB first
            // so the backend order includes 100% of items added by the customer!
            if (cartMutationCountRef.current > 0) {
                try {
                    await cartMutationChainRef.current;
                } catch {}
            }

            const res = await api.post("/orders/place", {
                session_id: sessionData.session.id,
            });

            // Reset cart mutation locks and explicitly clear the cart so placed items NEVER linger in the cart!
            cartMutationCountRef.current = 0;
            lastCartMutationTimeRef.current = 0;

            // Update session data directly from backend response (no extra GET request needed!)
            if (res.data.state) {
                setSessionData((prev: any) => ({
                    ...prev,
                    ...res.data.state,
                    restaurant: res.data.state.restaurant || prev?.restaurant,
                    branch: res.data.state.branch || prev?.branch,
                    categories: res.data.state.categories || prev?.categories,
                    menu_items: res.data.state.menu_items || prev?.menu_items,
                    cart: { id: null, subtotal: 0, cgst_amount: 0, sgst_amount: 0, total: 0, items: [] },
                }));
            } else {
                setSessionData((prev: any) =>
                    prev
                        ? {
                              ...prev,
                              cart: { id: null, subtotal: 0, cgst_amount: 0, sgst_amount: 0, total: 0, items: [] },
                          }
                        : prev
                );
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
            setAiPopupCard(null);

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
            triggerTopBannerToast(
                "✅",
                `Order #${orderNum} Sent to Kitchen!`,
                "Our chef has received your ticket. Sit back and enjoy cartoons or a joke while we prepare your food!",
                "#23d18b",
                6500,
                [
                    { id: "tell_joke", title: "😂 Hear a Joke" },
                    { id: "show_cartoons", title: "🎬 Kids Cartoons" },
                ]
            );
        } catch (err: any) {
            alert(err.response?.data?.detail || "Could not place order. Please try again.");
        } finally {
            setPlacingOrder(false);
        }
    }

    async function handleWaiterMarkDelivered(orderId: string) {
        if (!orderId || markingDelivered) return;
        setMarkingDelivered(true);
        try {
            const res = await api.post(`/kiosk/orders/${orderId}/mark-delivered`);
            // Seed all updated SERVED orders into announcedStatusKeysRef immediately so the WebSocket broadcast
            // (ORDER_STATUS_UPDATED -> SERVED) does NOT speak a second duplicate announcement!
            if (res.data?.state?.orders) {
                seedOrderStatuses(res.data.state.orders);
            } else {
                lastOrderStatusMapRef.current[orderId] = "SERVED";
                announcedStatusKeysRef.current.add(`${orderId}:SERVED`);
            }
            if (res.data?.state) {
                setSessionData((prev: any) => ({
                    ...prev,
                    ...res.data.state,
                    restaurant: res.data.state.restaurant || prev?.restaurant,
                    branch: res.data.state.branch || prev?.branch,
                    categories: res.data.state.categories || prev?.categories,
                    menu_items: res.data.state.menu_items || prev?.menu_items,
                }));
            }
            const updatedNums = (res.data?.updated_order_numbers || []).join(", #");
            const label = updatedNums ? `Order #${updatedNums}` : "Your Order";
            speakText(`${label} has been delivered and served at your table. Enjoy your delicious meal! You can scan the QR code whenever you are ready to pay.`);
            triggerTopBannerToast(
                "🍽️",
                `${label} Served — Enjoy Your Meal!`,
                "Your GST Bill & UPI QR Code are ready on screen for easy payment whenever you finish.",
                "#23d18b",
                7000
            );
            setShowServedBillWidget(true);
        } catch (err: any) {
            alert(err.response?.data?.detail || "Could not mark order as delivered.");
        } finally {
            setMarkingDelivered(false);
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

    // Auto-refresh un-ordered session when customer leaves without ordering (3 min idle -> 20s countdown -> fresh session)
    const activeOrdersCount = (sessionData?.orders || []).filter((o: any) => o.status !== "CANCELLED").length;
    const isSessionCheckedIn = Boolean(sessionData?.session?.id && checkedInSessionId === sessionData.session.id);

    useEffect(() => {
        if (!isSessionCheckedIn || goodbyeScreen || activeOrdersCount > 0) {
            setInactivityCountdown(null);
            return;
        }

        const markActivity = () => {
            lastInteractionAtRef.current = Date.now();
        };

        const events = ["pointerdown", "mousemove", "keydown", "touchstart", "wheel", "input"];
        events.forEach((ev) => document.addEventListener(ev, markActivity, { passive: true, capture: true }));

        const interval = setInterval(() => {
            if (showCartoonModal || birthdayOverlay || showAdminResetModal) {
                lastInteractionAtRef.current = Date.now();
                return;
            }
            const idleMs = Date.now() - lastInteractionAtRef.current;
            if (idleMs >= 180_000) {
                setInactivityCountdown((prev) => (prev === null ? 20 : prev));
            }
        }, 5000);

        return () => {
            clearInterval(interval);
            events.forEach((ev) => document.removeEventListener(ev, markActivity, true));
        };
    }, [isSessionCheckedIn, goodbyeScreen, activeOrdersCount, showCartoonModal, birthdayOverlay, showAdminResetModal]);

    useEffect(() => {
        if (inactivityCountdown === null) return;
        if (inactivityCountdown <= 0) {
            setInactivityCountdown(null);
            startOrResumeSession(activeToken, selectedTableId, true);
            return;
        }
        const timer = setTimeout(() => {
            setInactivityCountdown((prev) => (prev !== null ? prev - 1 : null));
        }, 1000);
        return () => clearTimeout(timer);
    }, [inactivityCountdown]);

    async function handleAdminUnlockSubmit(action: "fresh_session" | "change_table" | "return_admin") {
        setAdminResetError("");
        const val = adminPasswordInput.trim();
        if (!val) {
            setAdminResetError("Please enter admin password or PIN.");
            return;
        }

        setVerifyingAdminReset(true);
        const isMasterPin = val === "1234" || val === "admin123";
        if (!isMasterPin) {
            try {
                const staffInfo = JSON.parse(localStorage.getItem("hd_staff") || "{}");
                const emailToTest = staffInfo.email;
                if (!emailToTest) {
                    setAdminResetError("Incorrect Master PIN. Only Admin can unlock this kiosk.");
                    setVerifyingAdminReset(false);
                    return;
                }
                await api.post("/auth/login", { email: emailToTest, password: val });
            } catch {
                setAdminResetError("Incorrect admin password or PIN. Unlock denied.");
                setVerifyingAdminReset(false);
                return;
            }
        }

        setShowAdminResetModal(false);
        setAdminPasswordInput("");
        setAdminResetError("");
        setVerifyingAdminReset(false);

        if (action === "fresh_session") {
            sessionStorage.removeItem("hd_kiosk_checkedin_session");
            await startOrResumeSession(activeToken, selectedTableId, true);
            return;
        }

        adminUnlockedRef.current = true;
        exitKioskPointerLock();
        exitKioskFullscreen();
        localStorage.removeItem("hd_kiosk_token");
        localStorage.removeItem("hd_kiosk_table_id");
        sessionStorage.removeItem("hd_kiosk_checkedin_session");

        const hasStaffSession = Boolean(localStorage.getItem("hd_token"));
        if (action === "return_admin") {
            navigate(hasStaffSession ? "/admin/tables" : "/login", { replace: true });
        } else {
            window.location.href = "/kiosk";
        }
    }

    const isBoundToTable = Boolean(activeToken || selectedTableId);
    const shouldShowFullscreenLock =
        isBoundToTable &&
        !isStandalonePwa &&
        isFullscreenSupported &&
        !isFullscreen &&
        !showAdminResetModal &&
        !loading;

    const kioskLockOverlay = shouldShowFullscreenLock ? (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 100050,
                background: "rgba(7, 9, 18, 0.96)",
                backdropFilter: "blur(12px)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: 24,
                textAlign: "center",
            }}
            onClick={() => enterKioskFullscreen()}
        >
            <div
                className="card"
                style={{
                    maxWidth: 480,
                    width: "100%",
                    padding: "32px 26px",
                    border: "2px solid #ff6b35",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ fontSize: "3rem", marginBottom: 10 }}>🔒</div>
                <h2 style={{ fontSize: "1.5rem", fontWeight: 900, color: "#fff", marginBottom: 8 }}>
                    Table Kiosk Locked in Full Screen
                </h2>
                <p className="text-muted text-sm" style={{ marginBottom: 22, lineHeight: 1.5 }}>
                    This tablet is reserved for ordering at Table T{sessionData?.table?.table_number || ""}. Only an Admin can close or change the table.
                </p>
                <button
                    type="button"
                    className="btn"
                    style={{
                        width: "100%",
                        justifyContent: "center",
                        padding: "16px 20px",
                        fontSize: "1.1rem",
                        fontWeight: 900,
                        borderRadius: 14,
                        background: "linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)",
                        color: "#fff",
                        marginBottom: 12,
                    }}
                    onClick={() => enterKioskFullscreen()}
                >
                    🔒 Tap to Resume Full-Screen Kiosk
                </button>
                <button
                    type="button"
                    className="btn btn-outline"
                    style={{ width: "100%", justifyContent: "center", padding: "12px 16px" }}
                    onClick={() => {
                        setAdminResetError("");
                        setAdminPasswordInput("");
                        setShowAdminResetModal(true);
                    }}
                >
                    ⚙️ Admin Unlock (Change Table / Close Kiosk)
                </button>
            </div>
        </div>
    ) : null;

    const adminResetModalNode = showAdminResetModal ? (
        <div className="modal-overlay" style={{ zIndex: 100080 }} onClick={() => setShowAdminResetModal(false)}>
            <div className="card modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
                    <h2 style={{ margin: 0, fontSize: "1.2rem", display: "flex", alignItems: "center", gap: 8 }}>
                        ⚙️ Admin Kiosk Settings
                    </h2>
                    <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => setShowAdminResetModal(false)}
                    >
                        ✕
                    </button>
                </div>

                <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
                    This tablet is bound to <strong>Table T{sessionData?.table?.table_number}</strong> at{" "}
                    <strong>{sessionData?.restaurant?.name}</strong>.
                </p>

                <div style={{ background: "rgba(255,95,87,0.1)", border: "1px solid var(--red)", borderRadius: 10, padding: 14, marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, color: "var(--red)", fontSize: "0.85rem", marginBottom: 4 }}>
                        🔒 Admin Authorization Required
                    </div>
                    <div className="text-muted" style={{ fontSize: "0.78rem" }}>
                        Only an Admin can change the table or close the kiosk. Enter your Restaurant Admin password or Master PIN (<strong>1234</strong>).
                    </div>
                </div>

                {adminResetError && (
                    <div style={{ color: "var(--red)", fontSize: "0.82rem", marginBottom: 12 }}>
                        ⚠️ {adminResetError}
                    </div>
                )}

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleAdminUnlockSubmit("fresh_session");
                    }}
                >
                    <input
                        type="password"
                        className="input"
                        style={{ width: "100%", marginBottom: 14 }}
                        placeholder="Enter Admin Password or PIN (e.g. 1234)"
                        value={adminPasswordInput}
                        onChange={(e) => setAdminPasswordInput(e.target.value)}
                        autoFocus
                    />

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            style={{ width: "100%", justifyContent: "center" }}
                            disabled={verifyingAdminReset}
                        >
                            {verifyingAdminReset ? "Verifying…" : "🔄 Close Session & Start Fresh (New Customer)"}
                        </button>
                        <button
                            type="button"
                            className="btn btn-outline"
                            style={{ width: "100%", justifyContent: "center", borderColor: "var(--orange)", color: "var(--orange)" }}
                            disabled={verifyingAdminReset}
                            onClick={() => handleAdminUnlockSubmit("change_table")}
                        >
                            {verifyingAdminReset ? "Verifying…" : "🪑 Change / Unbind Table"}
                        </button>
                        <button
                            type="button"
                            className="btn btn-outline"
                            style={{ width: "100%", justifyContent: "center", borderColor: "var(--accent)", color: "var(--accent)" }}
                            disabled={verifyingAdminReset}
                            onClick={() => handleAdminUnlockSubmit("return_admin")}
                        >
                            {verifyingAdminReset ? "Verifying…" : "🔙 Exit to Admin Panel"}
                        </button>
                        <button
                            type="button"
                            className="btn btn-outline"
                            style={{ width: "100%", justifyContent: "center" }}
                            onClick={() => setShowAdminResetModal(false)}
                            disabled={verifyingAdminReset}
                        >
                            Cancel & Stay on Kiosk
                        </button>
                    </div>
                </form>
            </div>
        </div>
    ) : null;

    const kioskVirtualCursorNode = isPointerLocked ? (
        <div
            ref={virtualCursorRef}
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                zIndex: 2147483647,
                pointerEvents: "none",
                transform: `translate3d(${virtualPosRef.current.x}px, ${virtualPosRef.current.y}px, 0)`,
                willChange: "transform",
            }}
        >
            <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                style={{
                    filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.65))",
                    transform: isVirtualCursorInteractive ? "scale(1.1)" : "scale(1)",
                    transition: "transform 0.08s ease",
                }}
            >
                <path
                    d="M3 2L10.5 21L13.5 13.5L21 10.5L3 2Z"
                    fill={isVirtualCursorInteractive ? "#ff6b35" : "#ffffff"}
                    stroke="#0b0d14"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                />
            </svg>
        </div>
    ) : null;

    // ─── 1. GOODBYE & SESSION EXPIRED SCREEN (Requirement 10) ──────────────────
    if (goodbyeScreen) {
        return (
            <div
                style={{
                    minHeight: "100dvh",
                    background: "radial-gradient(circle at center, rgba(35,209,139,0.25) 0%, #0b0d17 70%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 24,
                }}
            >
                {kioskLockOverlay}
                {adminResetModalNode}
                {kioskVirtualCursorNode}
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
                            <div style={{ marginTop: 12 }}>
                                <a href="/login" className="btn btn-outline btn-sm">
                                    🔑 Log In to Restaurant Admin
                                </a>
                            </div>
                        </div>
                    ) : availableBranches.length === 0 ? (
                        <div>
                            <p className="text-muted" style={{ marginBottom: 16 }}>
                                No tables found for your account. Please log in with your Restaurant Admin or Staff credentials to set up this kiosk.
                            </p>
                            <a href="/login" className="btn btn-primary btn-sm">
                                🔑 Log In to Restaurant Admin
                            </a>
                        </div>
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
                                            onClick={() => {
                                                enterKioskFullscreen();
                                                setSelectedTableId(t.id);
                                            }}
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

    if (loading && !sessionData) {
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
        const nameEntered = welcomeName.trim().length > 0;
        return (
            <div
                style={{
                    minHeight: "100dvh",
                    maxHeight: "100dvh",
                    width: "100%",
                    overflowY: "auto",
                    WebkitOverflowScrolling: "touch",
                    background:
                        "radial-gradient(circle at 50% 0%, rgba(255,107,53,0.18) 0%, transparent 55%), linear-gradient(180deg, #0d0f1a 0%, #090b14 100%)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "clamp(16px, 3vw, 32px)",
                    boxSizing: "border-box",
                    position: "relative",
                }}
            >
                {kioskLockOverlay}
                {adminResetModalNode}
                {kioskVirtualCursorNode}
                <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{
                        position: "absolute",
                        top: 16,
                        right: 16,
                        opacity: 0.45,
                        fontSize: "0.8rem",
                        padding: "6px 10px",
                    }}
                    title="Admin Kiosk Settings"
                    onClick={() => {
                        setAdminResetError("");
                        setAdminPasswordInput("");
                        setShowAdminResetModal(true);
                    }}
                >
                    ⚙️
                </button>
                {/* Top: restaurant + table */}
                <div style={{ textAlign: "center", marginBottom: "clamp(18px, 3vh, 28px)", maxWidth: 640, width: "100%" }}>
                    <div
                        style={{
                            display: "inline-block",
                            background: "rgba(35,209,139,0.14)",
                            border: "1px solid var(--green)",
                            color: "var(--green)",
                            padding: "6px 18px",
                            borderRadius: 999,
                            fontWeight: 800,
                            fontSize: "clamp(0.88rem, 1.8vw, 1rem)",
                            marginBottom: 12,
                        }}
                    >
                        Table {sessionData.table.table_number}
                    </div>
                    <h1 style={{ fontSize: "clamp(1.75rem, 4vw, 2.5rem)", fontWeight: 900, color: "#fff", margin: 0, lineHeight: 1.15 }}>
                        Welcome to {sessionData.restaurant.name}
                    </h1>
                    <p style={{ color: "var(--text-muted)", fontSize: "clamp(0.95rem, 2vw, 1.1rem)", marginTop: 8 }}>
                        Please enter your name to start ordering
                    </p>
                </div>

                <form
                    onSubmit={handleCustomerCheckinSubmit}
                    style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: "clamp(14px, 2.2vh, 18px)" }}
                >
                    {/* Name input — highlighted & mandatory */}
                    <input
                        className="input"
                        style={{
                            width: "100%",
                            boxSizing: "border-box",
                            padding: "clamp(16px, 2.5vh, 22px) 22px",
                            fontSize: "clamp(1.25rem, 3vw, 1.6rem)",
                            fontWeight: 800,
                            textAlign: "center",
                            color: "#ffd166",
                            borderRadius: 18,
                            background: "rgba(255,255,255,0.06)",
                            border: `2px solid ${nameEntered ? "#ff6b35" : "rgba(255,107,53,0.55)"}`,
                            boxShadow: nameEntered
                                ? "0 0 0 5px rgba(255,107,53,0.18), 0 10px 30px rgba(0,0,0,0.4)"
                                : "0 0 0 4px rgba(255,107,53,0.08)",
                            outline: "none",
                            transition: "all 0.2s",
                        }}
                        placeholder="Enter Your Name *"
                        value={welcomeName}
                        onChange={(e) => setWelcomeName(e.target.value)}
                        required
                        autoFocus
                        autoComplete="off"
                    />

                    {/* Birthday tick (optional) */}
                    <button
                        type="button"
                        onClick={() => setWelcomeIsBirthday(!welcomeIsBirthday)}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 16,
                            width: "100%",
                            padding: "clamp(14px, 2vh, 16px) 20px",
                            borderRadius: 16,
                            cursor: "pointer",
                            background: welcomeIsBirthday ? "rgba(255,107,53,0.14)" : "rgba(255,255,255,0.04)",
                            border: `2px solid ${welcomeIsBirthday ? "#ff6b35" : "rgba(255,255,255,0.14)"}`,
                            color: "#fff",
                            fontSize: "clamp(1rem, 2.2vw, 1.2rem)",
                            fontWeight: 700,
                            textAlign: "left",
                            transition: "all 0.2s",
                        }}
                    >
                        <span
                            style={{
                                width: 34,
                                height: 34,
                                flexShrink: 0,
                                borderRadius: 10,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "1.3rem",
                                fontWeight: 900,
                                background: welcomeIsBirthday ? "#ff6b35" : "transparent",
                                border: `2px solid ${welcomeIsBirthday ? "#ff6b35" : "rgba(255,255,255,0.4)"}`,
                                color: "#fff",
                            }}
                        >
                            {welcomeIsBirthday ? "✓" : ""}
                        </span>
                        <span>🎂 It's my birthday today (Optional)</span>
                    </button>

                    {/* Primary CTA */}
                    <button
                        type="submit"
                        className="btn"
                        disabled={checkingIn || !nameEntered}
                        style={{
                            width: "100%",
                            padding: "clamp(16px, 2.4vh, 22px)",
                            fontSize: "clamp(1.15rem, 2.5vw, 1.4rem)",
                            fontWeight: 900,
                            borderRadius: 18,
                            justifyContent: "center",
                            background: "linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)",
                            color: "#fff",
                            opacity: nameEntered ? 1 : 0.5,
                            boxShadow: nameEntered ? "0 12px 30px rgba(255,107,53,0.45)" : "none",
                            transition: "all 0.2s",
                        }}
                    >
                        {checkingIn ? "Starting…" : "View Menu & Order  →"}
                    </button>
                </form>
            </div>
        );
    }

    const readyOrders = activeOrders.filter((o) => o.status === "READY");
    const servedOrders = activeOrders.filter((o) => o.status === "SERVED");
    const hasServedOrder = servedOrders.length > 0 && readyOrders.length === 0;
    const mainCategories = categories.slice(0, 4);
    const activeExtraCategory =
        selectedCategory !== "ALL" && !mainCategories.some((c) => c.id === selectedCategory)
            ? categories.find((c) => c.id === selectedCategory)
            : null;
    const isBusyWithEntertainment = showCartoonModal || Boolean(jokeBanner);

    function getCategoryIcon(catName: string): string {
        const n = (catName || "").toLowerCase();
        if (n.includes("starter") || n.includes("appetizer") || n.includes("snack") || n.includes("chaat")) return "🍢";
        if (n.includes("soup")) return "🥣";
        if (n.includes("salad") || n.includes("healthy") || n.includes("raita")) return "🥗";
        if (n.includes("tandoor") || n.includes("kebab") || n.includes("tikka") || n.includes("grill")) return "🔥";
        if (n.includes("biryani") || n.includes("rice") || n.includes("pulao")) return "🍛";
        if (n.includes("bread") || n.includes("roti") || n.includes("naan") || n.includes("paratha")) return "🫓";
        if (n.includes("main") || n.includes("curry") || n.includes("gravy") || n.includes("paneer") || n.includes("masala") || n.includes("dal")) return "🍲";
        if (n.includes("chinese") || n.includes("noodle") || n.includes("manchurian") || n.includes("momos") || n.includes("wok")) return "🍜";
        if (n.includes("pizza") || n.includes("pasta") || n.includes("italian")) return "🍕";
        if (n.includes("burger") || n.includes("sandwich") || n.includes("wrap") || n.includes("roll")) return "🍔";
        if (n.includes("south") || n.includes("dosa") || n.includes("idli")) return "🥞";
        if (n.includes("thali") || n.includes("combo") || n.includes("meal")) return "🍱";
        if (n.includes("seafood") || n.includes("fish") || n.includes("prawn")) return "🦐";
        if (n.includes("chicken") || n.includes("mutton") || n.includes("non-veg") || n.includes("meat")) return "🍗";
        if (n.includes("dessert") || n.includes("sweet") || n.includes("ice cream") || n.includes("cake") || n.includes("gulab")) return "🍨";
        if (n.includes("drink") || n.includes("beverage") || n.includes("juice") || n.includes("shake") || n.includes("mocktail") || n.includes("soda") || n.includes("lassi")) return "🥤";
        if (n.includes("tea") || n.includes("coffee") || n.includes("chai") || n.includes("hot")) return "☕";
        if (n.includes("breakfast")) return "🍳";
        return "🍽️";
    }

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100dvh",
                width: "100%",
                overflow: "hidden",
                background: "#0b0d14",
                position: "relative",
            }}
        >
            {/* ═══════════════════════════════════════════════════════════════════════
                TOP BANNER TOAST FOR EVERY STEP UPDATE (Solid Opaque Background & Larger Tablet View)
               ═══════════════════════════════════════════════════════════════════════ */}
            {statusToast && (
                <div
                    style={{
                        position: "fixed",
                        top: 14,
                        left: "50%",
                        transform: "translateX(-50%)",
                        zIndex: 10025,
                        width: "min(96vw, 1020px)",
                        background:
                            statusToast.color === "#23d18b"
                                ? "linear-gradient(90deg, #0c3b2e 0%, #111827 70%)"
                                : statusToast.color === "#ef4444"
                                ? "linear-gradient(90deg, #4c111b 0%, #111827 70%)"
                                : "linear-gradient(90deg, #3b1d11 0%, #111827 70%)",
                        border: `2.5px solid ${statusToast.color}`,
                        borderRadius: 16,
                        padding: "18px 26px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 18,
                        boxShadow: "0 20px 55px rgba(0,0,0,0.92), 0 0 32px rgba(35,209,139,0.28)",
                    }}
                >
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                            style={{
                                fontWeight: 900,
                                fontSize: "1.24rem",
                                color: statusToast.color,
                                marginBottom: 6,
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                            }}
                        >
                            <span style={{ fontSize: "1.35rem" }}>{statusToast.icon}</span>
                            <span>{statusToast.title}</span>
                        </div>
                        <div style={{ fontSize: "1rem", fontWeight: 600, color: "#f1f5f9", lineHeight: 1.45 }}>
                            {statusToast.message}
                        </div>
                        {statusToast.buttons && statusToast.buttons.length > 0 && (
                            <div className="flex gap-2" style={{ marginTop: 10, flexWrap: "wrap" }}>
                                {statusToast.buttons
                                    .filter((b) => !(b.id === "cancel_order" && !hasCancellableOrder))
                                    .map((b) => (
                                        <button
                                            key={b.id}
                                            type="button"
                                            className="btn btn-sm"
                                            style={{
                                                background: "#1e293b",
                                                border: `1.5px solid ${statusToast.color}`,
                                                color: "#fff",
                                                padding: "6px 14px",
                                                borderRadius: 999,
                                                fontSize: "0.85rem",
                                                fontWeight: 800,
                                            }}
                                            onClick={() => sendChatMessage(b.id, b.title, true)}
                                        >
                                            {b.title}
                                        </button>
                                    ))}
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        style={{
                            background: "#1e293b",
                            borderRadius: 10,
                            padding: "8px 16px",
                            borderColor: "rgba(255,255,255,0.3)",
                            color: "#f8fafc",
                            fontWeight: 700,
                            fontSize: "0.86rem",
                            flexShrink: 0,
                        }}
                        onClick={() => setStatusToast(null)}
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════════
                FULL-WIDTH (100%) TABLET-FRIENDLY MENU & CUSTOMER EXPERIENCE SCREEN
               ═══════════════════════════════════════════════════════════════════════ */}
            <div
                style={{
                    width: "100%",
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    height: "100dvh",
                    overflow: "hidden",
                }}
            >
                {/* TOP HEADER */}
                <header
                    style={{
                        padding: "12px 24px",
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

                    {/* ENTERTAINMENT, LANGUAGE, VOICE & INVOICE BUTTONS */}
                    <div className="flex gap-2 items-center" style={{ flexWrap: "wrap" }}>
                        <button
                            className="btn btn-outline btn-sm"
                            style={{ borderColor: "#f9ca24", color: "#f9ca24", fontWeight: 700 }}
                            onClick={() => sendChatMessage("tell_joke", "😂 Tell me a Joke", true)}
                        >
                            😂 Joke
                        </button>
                        <button
                            className="btn btn-outline btn-sm"
                            style={{ borderColor: "#54a0ff", color: "#54a0ff", fontWeight: 700 }}
                            onClick={() => setShowCartoonModal(true)}
                        >
                            🎬 Kids Cartoons
                        </button>
                        <button
                            className="btn btn-outline btn-sm"
                            style={{ borderColor: "#ff9f43", color: "#ff9f43", fontWeight: 700 }}
                            onClick={() => setShowBirthdayPrompt(true)}
                        >
                            🎂 Birthday
                        </button>
                        {activeOrders.length === 0 && (
                            <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                style={{ borderColor: "#23d18b", color: "#23d18b", fontWeight: 700 }}
                                onClick={() => startOrResumeSession(activeToken, selectedTableId, true)}
                                title="Start fresh session for a new customer"
                            >
                                🔄 New Guest
                            </button>
                        )}
                        {activeOrders.length > 0 && (
                            <button
                                className="btn btn-success btn-sm"
                                style={{ fontWeight: 800 }}
                                onClick={handleOpenBillModalDirect}
                            >
                                🧾 GST Bill & QR Pay (₹{ordersGrandTotal.toFixed(2)})
                            </button>
                        )}
                        {/* Language Selector (button cycle for full pointer-lock compatibility) */}
                        <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            style={{
                                padding: "6px 12px",
                                fontSize: "0.78rem",
                                borderRadius: 10,
                                background: "#1c2035",
                                borderColor: "var(--border)",
                                color: "#fff",
                            }}
                            onClick={() => {
                                const order: Array<"auto" | "en" | "hi" | "or"> = ["auto", "en", "hi", "or"];
                                const next = order[(order.indexOf(kioskLanguage) + 1) % order.length];
                                setKioskLanguage(next);
                            }}
                            title="Tap to change AI Voice Language"
                        >
                            {kioskLanguage === "auto"
                                ? "🌐 Auto Lang"
                                : kioskLanguage === "en"
                                ? "🇬🇧 English"
                                : kioskLanguage === "hi"
                                ? "🇮🇳 हिन्दी"
                                : "🇮🇳 ଓଡ଼ିଆ"}
                        </button>
                        <button
                            type="button"
                            className={`btn btn-sm ${voiceEnabled ? "btn-primary" : "btn-outline"}`}
                            onClick={() => {
                                if (voiceEnabled && "speechSynthesis" in window) window.speechSynthesis.cancel();
                                setVoiceEnabled(!voiceEnabled);
                            }}
                            title="Toggle AI Voice Output"
                        >
                            {voiceEnabled ? "🔊 AI Voice On" : "🔇 Muted"}
                        </button>
                        {/* Admin Tablet Reset / Unbind Trigger */}
                        <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            style={{ opacity: 0.6, fontSize: "0.75rem", padding: "4px 8px" }}
                            title="Admin Kiosk Hardware Settings"
                            onClick={() => {
                                setAdminResetError("");
                                setAdminPasswordInput("");
                                setShowAdminResetModal(true);
                            }}
                        >
                            ⚙️
                        </button>
                    </div>
                </header>

                {/* LIVE ORDER STATUS TRACKER BAR */}
                {activeOrders.length > 0 && (
                    <div
                        style={{
                            padding: "8px 24px",
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
                            <span style={{ fontWeight: 800, fontSize: "0.85rem", color: "#ff9f43" }}>
                                👨‍🍳 Live Order Status:
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
                                            border: "1px solid rgba(255,255,255,0.12)",
                                            fontSize: "0.8rem",
                                        }}
                                    >
                                        <strong>#{ord.order_number}</strong>
                                        <span className={`badge badge-${ord.status.toLowerCase()}`}>
                                            {ord.status === "READY" ? "ON THE WAY TO TABLE" : ord.status}
                                        </span>
                                        <span className="text-muted">({stageIdx + 1}/5)</span>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="flex gap-2 items-center">
                            {hasCancellableOrder && (
                                <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    style={{ borderColor: "var(--red)", color: "var(--red)", padding: "4px 10px" }}
                                    onClick={() => sendChatMessage("cancel order", "❌ Cancel Order", true)}
                                >
                                    ❌ Cancel Order
                                </button>
                            )}
                            <button
                                className="btn btn-sm"
                                style={{ background: "#ff6b35", color: "#fff", padding: "5px 12px" }}
                                onClick={() => setShowCartoonModal(true)}
                            >
                                🍿 Watch Cartoons While Waiting
                            </button>
                        </div>
                    </div>
                )}

                {/* EASY CUSTOMER GUIDE + SEARCH + MAIN CATEGORY FILTER BAR WITH "ALL MENU" DROPDOWN */}
                <div
                    style={{
                        padding: "12px 24px",
                        background: "#111422",
                        borderBottom: "1px solid var(--border)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                    }}
                >
                    {/* Row 1: Search Bar + Veg / Non-Veg / Bestsellers */}
                    <div
                        style={{
                            display: "flex",
                            gap: 12,
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 240 }}>
                            <input
                                className="input"
                                style={{
                                    maxWidth: 340,
                                    padding: "10px 16px",
                                    background: "#181c30",
                                    borderRadius: 999,
                                    fontSize: "0.92rem",
                                }}
                                placeholder="🔍 Search any dish (e.g. Paneer, Biryani)…"
                                value={searchQuery}
                                onChange={(e) => {
                                    setAiMatchedItemIds(null);
                                    setSearchQuery(e.target.value);
                                }}
                            />
                            <span className="text-muted text-sm" style={{ display: "inline-block" }}>
                                💡 Tap <strong>+ ADD</strong> on any dish or tap <strong>🎤 Speak</strong> at the bottom!
                            </span>
                        </div>

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
                                    ✨ Showing {aiMatchedItemIds.length} AI Picks · ✕ Reset
                                </button>
                            )}
                            <button
                                className="btn btn-sm"
                                style={{
                                    borderRadius: 999,
                                    padding: "7px 14px",
                                    background: vegFilter === "ALL" && !bestsellerOnly ? "#ff6b35" : "#181c30",
                                    color: vegFilter === "ALL" && !bestsellerOnly ? "#fff" : "var(--text-muted)",
                                    border: "1px solid rgba(255,255,255,0.12)",
                                    fontWeight: 700,
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
                                    padding: "7px 14px",
                                    background: vegFilter === "VEG" ? "var(--green)" : "#181c30",
                                    color: vegFilter === "VEG" ? "#0b0d14" : "var(--green)",
                                    border: "1px solid var(--green)",
                                    fontWeight: 800,
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
                                    padding: "7px 14px",
                                    background: vegFilter === "NONVEG" ? "var(--red)" : "#181c30",
                                    color: vegFilter === "NONVEG" ? "#fff" : "var(--red)",
                                    border: "1px solid var(--red)",
                                    fontWeight: 800,
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
                                    padding: "7px 14px",
                                    background: bestsellerOnly ? "linear-gradient(135deg, #f9ca24, #f0932b)" : "#181c30",
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

                    {/* Row 2: Main Categories (3-4 buttons) + "All Menu ▾" Hover/Click Dropdown */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            flexWrap: "wrap",
                            position: "relative",
                        }}
                    >
                        {/* All Menu Dropdown Trigger (Hover or Click opens all categories) */}
                        <div
                            style={{ position: "relative" }}
                            onMouseEnter={() => setShowAllCategoriesMenu(true)}
                            onMouseLeave={() => setShowAllCategoriesMenu(false)}
                        >
                            <button
                                type="button"
                                className="btn btn-sm"
                                style={{
                                    borderRadius: 999,
                                    padding: "8px 18px",
                                    fontSize: "0.9rem",
                                    fontWeight: 900,
                                    background:
                                        selectedCategory === "ALL" && !aiMatchedItemIds
                                            ? "linear-gradient(135deg, #ff6b35, #f7931e)"
                                            : "#1c2038",
                                    color: "#fff",
                                    border: "1.5px solid #ff6b35",
                                    boxShadow: "0 4px 14px rgba(255,107,53,0.28)",
                                }}
                                onClick={() => {
                                    setShowAllCategoriesMenu((prev) => !prev);
                                }}
                            >
                                🔥 All Menu ({categories.length} Categories) ▾
                            </button>

                            {/* Dropdown Popover listing all categories as compact Icon-Style Tiles when clicked or hovered */}
                            {showAllCategoriesMenu && (
                                <div
                                    style={{
                                        position: "absolute",
                                        top: "100%",
                                        left: 0,
                                        paddingTop: 8,
                                        zIndex: 9990,
                                        width: "min(92vw, 680px)",
                                    }}
                                >
                                    <div
                                        style={{
                                            background: "#13172b",
                                            border: "2px solid #ff6b35",
                                            borderRadius: 18,
                                            padding: "14px 16px",
                                            boxShadow: "0 24px 60px rgba(0,0,0,0.92)",
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                marginBottom: 12,
                                                paddingBottom: 8,
                                                borderBottom: "1px solid rgba(255,255,255,0.1)",
                                            }}
                                        >
                                            <span style={{ fontWeight: 900, fontSize: "0.9rem", color: "#ffd166" }}>
                                                ✨ Choose Menu Category
                                            </span>
                                            <button
                                                type="button"
                                                style={{
                                                    background: "rgba(255,255,255,0.08)",
                                                    border: "none",
                                                    borderRadius: 8,
                                                    padding: "3px 9px",
                                                    color: "#cbd5e1",
                                                    cursor: "pointer",
                                                    fontSize: "0.82rem",
                                                    fontWeight: 800,
                                                }}
                                                onClick={() => setShowAllCategoriesMenu(false)}
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        <div
                                            style={{
                                                display: "grid",
                                                gridTemplateColumns: "repeat(auto-fill, minmax(105px, 1fr))",
                                                gap: 10,
                                                maxHeight: "48vh",
                                                overflowY: "auto",
                                            }}
                                        >
                                            <button
                                                type="button"
                                                style={{
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    gap: 5,
                                                    borderRadius: 14,
                                                    padding: "10px 8px",
                                                    cursor: "pointer",
                                                    background:
                                                        selectedCategory === "ALL"
                                                            ? "linear-gradient(135deg, #ff6b35, #f7931e)"
                                                            : "#1c223d",
                                                    color: "#fff",
                                                    border:
                                                        selectedCategory === "ALL"
                                                            ? "1.5px solid #ffd166"
                                                            : "1px solid rgba(255,255,255,0.1)",
                                                    boxShadow:
                                                        selectedCategory === "ALL"
                                                            ? "0 6px 16px rgba(255,107,53,0.35)"
                                                            : "none",
                                                    textAlign: "center",
                                                }}
                                                onClick={() => {
                                                    setAiMatchedItemIds(null);
                                                    setSelectedCategory("ALL");
                                                    setSearchQuery("");
                                                    setShowAllCategoriesMenu(false);
                                                }}
                                            >
                                                <span style={{ fontSize: "1.65rem", lineHeight: 1 }}>🍽️</span>
                                                <span
                                                    style={{
                                                        fontSize: "0.78rem",
                                                        fontWeight: 800,
                                                        lineHeight: 1.2,
                                                        maxWidth: "100%",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        whiteSpace: "nowrap",
                                                    }}
                                                >
                                                    All Dishes
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: "0.68rem",
                                                        fontWeight: 700,
                                                        padding: "1px 7px",
                                                        borderRadius: 999,
                                                        background: "rgba(0,0,0,0.3)",
                                                        color: "#ffd166",
                                                    }}
                                                >
                                                    {menuItems.length} items
                                                </span>
                                            </button>
                                            {categories.map((cat) => {
                                                const count = menuItems.filter((m) => m.category_id === cat.id).length;
                                                const isSel = selectedCategory === cat.id;
                                                const icon = getCategoryIcon(cat.name);
                                                return (
                                                    <button
                                                        key={cat.id}
                                                        type="button"
                                                        style={{
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            gap: 5,
                                                            borderRadius: 14,
                                                            padding: "10px 8px",
                                                            cursor: "pointer",
                                                            background: isSel
                                                                ? "linear-gradient(135deg, #ff6b35, #f7931e)"
                                                                : "#1c223d",
                                                            color: isSel ? "#fff" : "#f1f5f9",
                                                            border: isSel
                                                                ? "1.5px solid #ffd166"
                                                                : "1px solid rgba(255,255,255,0.1)",
                                                            boxShadow: isSel
                                                                ? "0 6px 16px rgba(255,107,53,0.35)"
                                                                : "none",
                                                            textAlign: "center",
                                                        }}
                                                        onClick={() => {
                                                            setAiMatchedItemIds(null);
                                                            setSelectedCategory(cat.id);
                                                            setSearchQuery("");
                                                            setShowAllCategoriesMenu(false);
                                                        }}
                                                    >
                                                        <span style={{ fontSize: "1.65rem", lineHeight: 1 }}>{icon}</span>
                                                        <span
                                                            style={{
                                                                fontSize: "0.78rem",
                                                                fontWeight: isSel ? 800 : 700,
                                                                lineHeight: 1.2,
                                                                maxWidth: "100%",
                                                                overflow: "hidden",
                                                                textOverflow: "ellipsis",
                                                                whiteSpace: "nowrap",
                                                            }}
                                                        >
                                                            {cat.name}
                                                        </span>
                                                        <span
                                                            style={{
                                                                fontSize: "0.68rem",
                                                                fontWeight: 700,
                                                                padding: "1px 7px",
                                                                borderRadius: 999,
                                                                background: isSel ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.06)",
                                                                color: isSel ? "#ffd166" : "#94a3b8",
                                                            }}
                                                        >
                                                            {count} items
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Quick "Show All Dishes" button */}
                        <button
                            type="button"
                            className="btn btn-sm"
                            style={{
                                borderRadius: 999,
                                padding: "8px 16px",
                                background:
                                    selectedCategory === "ALL" && !aiMatchedItemIds
                                        ? "rgba(255,107,53,0.22)"
                                        : "#181c30",
                                color: selectedCategory === "ALL" && !aiMatchedItemIds ? "#ffd166" : "var(--text)",
                                border:
                                    selectedCategory === "ALL" && !aiMatchedItemIds
                                        ? "1px solid #ffd166"
                                        : "1px solid rgba(255,255,255,0.08)",
                                fontWeight: 700,
                            }}
                            onClick={() => {
                                setAiMatchedItemIds(null);
                                setSelectedCategory("ALL");
                                setSearchQuery("");
                            }}
                        >
                            🍽️ All Dishes
                        </button>

                        {/* Only show 4 Main Categories inline on Tablet so buttons are large & easy to tap */}
                        {mainCategories.map((cat) => (
                            <button
                                key={cat.id}
                                type="button"
                                className="btn btn-sm"
                                style={{
                                    borderRadius: 999,
                                    padding: "8px 16px",
                                    fontSize: "0.88rem",
                                    fontWeight: selectedCategory === cat.id ? 800 : 600,
                                    background:
                                        selectedCategory === cat.id
                                            ? "linear-gradient(135deg, #ff6b35, #f7931e)"
                                            : "#181c30",
                                    color: selectedCategory === cat.id ? "#fff" : "var(--text)",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                }}
                                onClick={() => {
                                    setAiMatchedItemIds(null);
                                    setSelectedCategory(cat.id);
                                    setSearchQuery("");
                                }}
                            >
                                {getCategoryIcon(cat.name)} {cat.name}
                            </button>
                        ))}

                        {/* If customer selected a category from the "All Menu" dropdown that isn't in the first 4, show it as an active pill */}
                        {activeExtraCategory && (
                            <button
                                type="button"
                                className="btn btn-sm"
                                style={{
                                    borderRadius: 999,
                                    padding: "8px 16px",
                                    fontSize: "0.88rem",
                                    fontWeight: 800,
                                    background: "linear-gradient(135deg, #ff6b35, #f7931e)",
                                    color: "#fff",
                                    border: "1px solid #ffd166",
                                }}
                                onClick={() => setShowAllCategoriesMenu(true)}
                            >
                                {getCategoryIcon(activeExtraCategory.name)} {activeExtraCategory.name} ✕
                            </button>
                        )}
                    </div>
                </div>

                {/* ATTRACTIVE FOOD APP MENU GRID WITH IMAGES (Extra bottom padding for floating voice & cart dock) */}
                <div
                    style={{
                        flex: 1,
                        overflowY: "auto",
                        padding: "18px 24px 150px",
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(225px, 1fr))",
                        gridAutoRows: "max-content",
                        gap: 18,
                        alignContent: "start",
                    }}
                >
                    {filteredItems.map((item) => {
                        const inCart = cartQtyMap[item.id];
                        const isUnavailable = item.is_available === false;
                        const imgUrl = item.image_url || getFoodImage(item.name, item.is_veg);
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
                                    opacity: isUnavailable ? 0.55 : 1,
                                    filter: isUnavailable ? "grayscale(0.85)" : undefined,
                                    pointerEvents: isUnavailable ? "none" : undefined,
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
                                                    width: 30,
                                                    height: 30,
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
                                                    width: 30,
                                                    height: 30,
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
                                                padding: "10px 22px",
                                                fontWeight: 800,
                                                fontSize: "0.88rem",
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
            </div>

            {/* ═══════════════════════════════════════════════════════════════════════
                FLOATING TOP-RIGHT / SIDE POPUP STACK (Non-Intrusive: Coexists with Video & Joke!)
                1. Waiter Order Delivery Confirmation Popup (When Chef marks READY)
                2. Auto Billing & QR Code Payment Card (Once Order is marked SERVED)
                3. Joke Card & Main-Screen AI Bot Response Popup (Orders, Cart, Recommendations)
               ═══════════════════════════════════════════════════════════════════════ */}
            <div
                style={{
                    position: "fixed",
                    top: statusToast ? 96 : 74,
                    right: 20,
                    zIndex: 10010,
                    width: "min(92vw, 390px)",
                    maxHeight: "calc(100vh - 200px)",
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    pointerEvents: "none",
                }}
            >
                {/* 1. WAITER ORDER DELIVERY CONFIRMATION POPUP (Holds until Waiter clicks Delivered) */}
                {readyOrders.length > 0 && (
                    <div
                        style={{
                            pointerEvents: "auto",
                            background: "linear-gradient(145deg, #1b203d 0%, #121528 100%)",
                            border: "2px solid #23d18b",
                            borderRadius: 18,
                            padding: "18px 20px",
                            boxShadow: "0 18px 45px rgba(0,0,0,0.75), 0 0 28px rgba(35,209,139,0.28)",
                        }}
                    >
                        <div
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                background: "rgba(35,209,139,0.16)",
                                border: "1px solid #23d18b",
                                color: "#23d18b",
                                padding: "4px 12px",
                                borderRadius: 999,
                                fontSize: "0.75rem",
                                fontWeight: 900,
                                marginBottom: 10,
                            }}
                        >
                            🛎️ ORDER READY & ON THE WAY TO TABLE T{sessionData.table.table_number}
                        </div>

                        <div style={{ fontSize: "1.12rem", fontWeight: 900, color: "#fff", marginBottom: 6 }}>
                            🍽️ Your Order #{readyOrders.map((o) => o.order_number).join(", #")} is on the way to your table!
                        </div>

                        <p style={{ fontSize: "0.86rem", color: "#cbd5e1", lineHeight: 1.45, marginBottom: 12 }}>
                            Our chef has prepared your fresh meal and our waiter is bringing it right to your table.
                        </p>

                        <div
                            style={{
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid rgba(255,255,255,0.12)",
                                borderRadius: 12,
                                padding: "12px 14px",
                                textAlign: "center",
                            }}
                        >
                            <div style={{ fontWeight: 900, fontSize: "1rem", color: "#ffd166", marginBottom: 10 }}>
                                Is your order served at the table?
                            </div>
                            <button
                                type="button"
                                className="btn btn-success"
                                disabled={markingDelivered}
                                onClick={() => handleWaiterMarkDelivered(readyOrders[0].id)}
                                style={{
                                    width: "100%",
                                    justifyContent: "center",
                                    padding: "12px 18px",
                                    fontSize: "1rem",
                                    fontWeight: 900,
                                    borderRadius: 12,
                                    boxShadow: "0 8px 22px rgba(35,209,139,0.4)",
                                }}
                            >
                                {markingDelivered ? "Marking as Served…" : "✅ Delivered"}
                            </button>
                            <div
                                style={{
                                    marginTop: 8,
                                    fontSize: "0.75rem",
                                    color: "#ff9f43",
                                    fontWeight: 700,
                                    lineHeight: 1.35,
                                }}
                            >
                                ⚠️ Only for Waiter: Please click "Delivered" only after serving the order to the table.
                            </div>
                        </div>
                    </div>
                )}

                {/* 2. AUTO BILLING DETAILS & QR CODE POPUP ONCE ORDER IS SERVED (Coexists with Video/Joke) */}
                {hasServedOrder && (showServedBillWidget || !showBillModal) && (
                    <div
                        style={{
                            pointerEvents: "auto",
                            background: "linear-gradient(155deg, #161c33 0%, #101425 100%)",
                            border: "2px solid var(--green)",
                            borderRadius: 18,
                            padding: "16px 18px",
                            boxShadow: "0 18px 45px rgba(0,0,0,0.75), 0 0 25px rgba(35,209,139,0.22)",
                        }}
                    >
                        <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
                            <span
                                style={{
                                    background: "rgba(35,209,139,0.16)",
                                    border: "1px solid var(--green)",
                                    color: "var(--green)",
                                    padding: "3px 10px",
                                    borderRadius: 999,
                                    fontSize: "0.73rem",
                                    fontWeight: 900,
                                }}
                            >
                                🧾 ORDER SERVED · SCAN TO PAY BILL
                            </span>
                            <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                style={{ padding: "2px 8px", fontSize: "0.72rem" }}
                                onClick={() => setShowBillModal(true)}
                            >
                                Full Invoice ↗
                            </button>
                        </div>

                        <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 12 }}>
                            <div
                                style={{
                                    background: "#fff",
                                    padding: 8,
                                    borderRadius: 12,
                                    flexShrink: 0,
                                }}
                            >
                                <QRCodeCanvas value={upiPayUri} size={108} level="M" includeMargin={false} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                    Table T{sessionData.table.table_number} · GST Total
                                </div>
                                <div style={{ fontSize: "1.55rem", fontWeight: 900, color: "var(--green)", lineHeight: 1.15 }}>
                                    ₹{ordersGrandTotal.toFixed(2)}
                                </div>
                                <div className="text-muted" style={{ fontSize: "0.72rem", marginTop: 3 }}>
                                    Sub: ₹{ordersSubtotal.toFixed(0)} + GST: ₹{(ordersCgst + ordersSgst).toFixed(2)}
                                </div>
                                <div style={{ fontSize: "0.72rem", color: "#ffd166", marginTop: 4 }}>
                                    UPI: <strong>{effectiveUpiId}</strong>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                style={{ flex: 1, justifyContent: "center", fontSize: "0.78rem" }}
                                onClick={handleOpenBillModalDirect}
                            >
                                📄 View Items
                            </button>
                            <button
                                type="button"
                                className="btn btn-success btn-sm"
                                style={{ flex: 1.4, justifyContent: "center", fontWeight: 900, fontSize: "0.82rem" }}
                                disabled={payingQR}
                                onClick={() =>
                                    handlePayViaTableQR(ordersGrandTotal, ordersSubtotal, ordersCgst, ordersSgst)
                                }
                            >
                                {payingQR ? "Processing…" : `✅ Payment Done (₹${ordersGrandTotal.toFixed(0)})`}
                            </button>
                        </div>
                    </div>
                )}

                {/* 3. JOKE ENGAGEMENT CARD (Stays alongside Order / Bill popups without interruption) */}
                {jokeBanner && (
                    <div
                        style={{
                            pointerEvents: "auto",
                            background: "linear-gradient(145deg, #231f38 0%, #171528 100%)",
                            border: "1.5px solid #f9ca24",
                            borderRadius: 16,
                            padding: "14px 16px",
                            boxShadow: "0 14px 35px rgba(0,0,0,0.65)",
                        }}
                    >
                        <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
                            <span style={{ fontWeight: 900, fontSize: "0.84rem", color: "#f9ca24" }}>
                                😂 AI Waiter Joke Time!
                            </span>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    style={{ padding: "2px 8px", fontSize: "0.72rem", borderColor: "#f9ca24", color: "#f9ca24" }}
                                    onClick={() => sendChatMessage("tell_joke", "😂 Another Joke", true)}
                                >
                                    Another 😂
                                </button>
                                <button
                                    type="button"
                                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer" }}
                                    onClick={() => setJokeBanner(null)}
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                        <div style={{ fontSize: "0.88rem", color: "#fff", lineHeight: 1.45, whiteSpace: "pre-line" }}>
                            {jokeBanner}
                        </div>
                    </div>
                )}

                {/* 4. MAIN SCREEN AI BOT RESPONSE POPUP (Shows Orders, Cart Updates, Recommendations, etc.) */}
                {aiPopupCard && (
                    <div
                        style={{
                            pointerEvents: "auto",
                            background: "linear-gradient(155deg, #1b203a 0%, #13172b 100%)",
                            border: "1.5px solid #ff6b35",
                            borderRadius: 16,
                            padding: "16px 18px",
                            boxShadow: "0 16px 40px rgba(0,0,0,0.75)",
                        }}
                    >
                        <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
                            <div style={{ fontWeight: 900, fontSize: "0.92rem", color: "#ffd166" }}>
                                {aiPopupCard.title}
                            </div>
                            <button
                                type="button"
                                style={{
                                    background: "rgba(255,255,255,0.08)",
                                    border: "none",
                                    color: "#cbd5e1",
                                    borderRadius: 8,
                                    padding: "2px 8px",
                                    cursor: "pointer",
                                }}
                                onClick={() => setAiPopupCard(null)}
                            >
                                ✕
                            </button>
                        </div>
                        <div
                            style={{
                                fontSize: "0.86rem",
                                color: "#e2e8f0",
                                lineHeight: 1.5,
                                whiteSpace: "pre-line",
                                maxHeight: 180,
                                overflowY: "auto",
                            }}
                        >
                            {aiPopupCard.body}
                        </div>
                        {aiPopupCard.buttons && aiPopupCard.buttons.length > 0 && (
                            <div className="flex gap-2" style={{ marginTop: 12, flexWrap: "wrap" }}>
                                {aiPopupCard.buttons
                                    .filter((b) => !(b.id === "cancel_order" && !hasCancellableOrder))
                                    .map((b) => (
                                        <button
                                            key={b.id}
                                            type="button"
                                            className="btn btn-sm"
                                            style={{
                                                background: "rgba(255,107,53,0.18)",
                                                border: "1px solid #ff6b35",
                                                color: "#fff",
                                                borderRadius: 10,
                                                fontWeight: 700,
                                            }}
                                            onClick={() => sendChatMessage(b.id, b.title, true)}
                                        >
                                            {b.title}
                                        </button>
                                    ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ═══════════════════════════════════════════════════════════════════════
                FLOATING BOTTOM VOICE MIC, AI INPUT & CART BAR (Noticeable & Tablet-Friendly)
               ═══════════════════════════════════════════════════════════════════════ */}
            <div
                style={{
                    position: "fixed",
                    bottom: 12,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: "min(96vw, 1280px)",
                    zIndex: 9980,
                    background: "linear-gradient(90deg, rgba(21,24,42,0.97) 0%, rgba(28,24,52,0.97) 100%)",
                    border: "1.5px solid rgba(255,107,53,0.45)",
                    borderRadius: 20,
                    padding: "10px 18px",
                    boxShadow: "0 16px 45px rgba(0,0,0,0.75), 0 0 25px rgba(255,107,53,0.18)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    backdropFilter: "blur(12px)",
                }}
            >
                {/* Live Voice Transcript / Bot Thinking Notice */}
                {(voiceTranscriptNotice || botThinking) && (
                    <div
                        style={{
                            padding: "5px 12px",
                            background: "rgba(255,159,67,0.16)",
                            border: "1px solid rgba(255,159,67,0.4)",
                            borderRadius: 10,
                            color: "#ffd166",
                            fontSize: "0.8rem",
                            fontWeight: 700,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                        }}
                    >
                        <span>
                            {botThinking ? "🤖 AI Waiter is processing your request…" : voiceTranscriptNotice}
                        </span>
                        {voiceTranscriptNotice && (
                            <button
                                type="button"
                                onClick={() => setVoiceTranscriptNotice("")}
                                style={{ background: "none", border: "none", color: "#fff", cursor: "pointer" }}
                            >
                                ✕
                            </button>
                        )}
                    </div>
                )}

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 14,
                        flexWrap: "wrap",
                    }}
                >
                    {/* LEFT: FLOATING VOICE SPEAK BUTTON + AI CHAT INPUT */}
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            setVoiceTranscriptNotice("");
                            sendChatMessage(undefined, undefined, true);
                        }}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            flex: 1.4,
                            minWidth: 300,
                        }}
                    >
                        <button
                            type="button"
                            onClick={toggleVoiceInput}
                            className={isListening ? "pulse" : ""}
                            style={{
                                background: isListening
                                    ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
                                    : "linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)",
                                color: "#fff",
                                border: "2px solid rgba(255,255,255,0.25)",
                                borderRadius: 999,
                                padding: "11px 20px",
                                fontWeight: 900,
                                fontSize: "0.95rem",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                boxShadow: isListening
                                    ? "0 0 25px rgba(239,68,68,0.7)"
                                    : "0 6px 20px rgba(255,107,53,0.45)",
                                flexShrink: 0,
                            }}
                            title={isListening ? "Tap to Finish & Send" : "Tap to Speak with AI Waiter"}
                        >
                            <span style={{ fontSize: "1.15rem" }}>{isListening ? "⏹️" : "🎤"}</span>
                            <span>{isListening ? "Done Speaking" : "Tap to Speak"}</span>
                        </button>

                        <input
                            className="input"
                            style={{
                                flex: 1,
                                minWidth: 160,
                                borderRadius: 999,
                                padding: "10px 16px",
                                background: "rgba(0,0,0,0.4)",
                                border: "1px solid rgba(255,255,255,0.18)",
                                fontSize: "0.9rem",
                            }}
                            placeholder={
                                isListening
                                    ? "🎤 Listening… speak your order now!"
                                    : "Type or speak: '2 Butter Naan', 'best dishes', 'confirm order'…"
                            }
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                        />

                        <button
                            type="submit"
                            className="btn"
                            style={{
                                background: "#ff6b35",
                                color: "#fff",
                                borderRadius: 999,
                                padding: "10px 18px",
                                fontWeight: 800,
                                flexShrink: 0,
                            }}
                            disabled={botThinking}
                        >
                            Send
                        </button>
                    </form>

                    {/* RIGHT: CART SUMMARY & PLACE ORDER / BILL ACTIONS */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            flexWrap: "wrap",
                        }}
                    >
                        <div
                            style={{
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid rgba(255,255,255,0.12)",
                                borderRadius: 14,
                                padding: "6px 14px",
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                            }}
                        >
                            <div>
                                <div style={{ fontWeight: 900, fontSize: "0.92rem", color: "#fff" }}>
                                    🛒 Cart: {(cart.items || []).reduce((s: number, i: CartItem) => s + i.quantity, 0)} items ·{" "}
                                    <span style={{ color: "var(--green)" }}>₹{Number(cart.total || 0).toFixed(2)}</span>
                                </div>
                                <div className="text-muted" style={{ fontSize: "0.7rem" }}>
                                    incl. GST ₹{(Number(cart.cgst_amount || 0) + Number(cart.sgst_amount || 0)).toFixed(2)}
                                </div>
                            </div>
                            {cart.items?.length > 0 && (
                                <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    style={{
                                        padding: "4px 10px",
                                        fontSize: "0.74rem",
                                        color: "var(--red)",
                                        borderColor: "var(--red)",
                                        fontWeight: 800,
                                        borderRadius: 8,
                                    }}
                                    onClick={() => setShowCartRemoveModal(true)}
                                >
                                    🗑️ Edit / Remove
                                </button>
                            )}
                        </div>

                        {cart.items?.length > 0 && (
                            <button
                                type="button"
                                onClick={handleInitiatePlaceOrder}
                                style={{
                                    background: "linear-gradient(135deg, #23d18b 0%, #10b981 100%)",
                                    color: "#09131c",
                                    border: "none",
                                    borderRadius: 14,
                                    padding: "11px 20px",
                                    fontWeight: 900,
                                    fontSize: "0.92rem",
                                    cursor: "pointer",
                                    boxShadow: "0 6px 20px rgba(35,209,139,0.4)",
                                }}
                            >
                                🍽️ Place Order (₹{Number(cart.total).toFixed(0)})
                            </button>
                        )}

                        {activeOrders.length === 0 && (
                            <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                style={{ borderColor: "#23d18b", color: "#23d18b", fontWeight: 700 }}
                                onClick={() => startOrResumeSession(activeToken, selectedTableId, true)}
                                title="Start fresh session for a new customer"
                            >
                                🔄 New Guest
                            </button>
                        )}
                        {activeOrders.length > 0 && (
                            <button
                                type="button"
                                className="btn btn-success"
                                style={{ borderRadius: 14, padding: "11px 16px", fontWeight: 900 }}
                                onClick={handleOpenBillModalDirect}
                            >
                                🧾 Pay Bill (₹{ordersGrandTotal.toFixed(0)})
                            </button>
                        )}
                    </div>
                </div>
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
                MODAL B: KIDS CARTOON THEATRE (Requirement 5: Working Video Player — Coexists with Order/Bill/Joke Popups!)
               ═══════════════════════════════════════════════════════════════════════ */}
            {showCartoonModal && (
                <div
                    className="modal-overlay"
                    style={{
                        justifyContent:
                            readyOrders.length > 0 || hasServedOrder || Boolean(jokeBanner) || Boolean(aiPopupCard)
                                ? "flex-start"
                                : "center",
                        paddingLeft:
                            readyOrders.length > 0 || hasServedOrder || Boolean(jokeBanner) || Boolean(aiPopupCard)
                                ? 24
                                : undefined,
                        zIndex: 9995,
                    }}
                    onClick={() => setShowCartoonModal(false)}
                >
                    <div
                        className="card modal"
                        style={{
                            maxWidth:
                                readyOrders.length > 0 || hasServedOrder || Boolean(jokeBanner) || Boolean(aiPopupCard)
                                    ? "min(62vw, 760px)"
                                    : 820,
                            width: "95%",
                        }}
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

            {inactivityCountdown !== null && (
                <div className="modal-overlay" style={{ zIndex: 100040 }}>
                    <div
                        className="card modal"
                        style={{
                            maxWidth: 460,
                            textAlign: "center",
                            border: "2px solid #ff9f43",
                            padding: "28px 24px",
                        }}
                    >
                        <div style={{ fontSize: "2.8rem", marginBottom: 8 }}>🕒</div>
                        <h2 style={{ fontSize: "1.4rem", fontWeight: 900, color: "#fff", marginBottom: 8 }}>
                            Are you still ordering?
                        </h2>
                        <p className="text-muted text-sm" style={{ marginBottom: 20, lineHeight: 1.5 }}>
                            No order has been placed yet. Refreshing this table for the next customer in{" "}
                            <strong style={{ color: "#ff9f43", fontSize: "1rem" }}>{inactivityCountdown}s</strong>…
                        </p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <button
                                type="button"
                                className="btn"
                                style={{
                                    width: "100%",
                                    justifyContent: "center",
                                    padding: "14px 18px",
                                    fontSize: "1.05rem",
                                    fontWeight: 900,
                                    borderRadius: 12,
                                    background: "linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)",
                                    color: "#fff",
                                }}
                                onClick={() => {
                                    lastInteractionAtRef.current = Date.now();
                                    setInactivityCountdown(null);
                                }}
                            >
                                👋 Yes, I'm Still Here
                            </button>
                            <button
                                type="button"
                                className="btn btn-outline"
                                style={{ width: "100%", justifyContent: "center", padding: "12px 16px" }}
                                onClick={() => {
                                    setInactivityCountdown(null);
                                    startOrResumeSession(activeToken, selectedTableId, true);
                                }}
                            >
                                🔄 New Guest / Start Over Now
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {kioskLockOverlay}
            {adminResetModalNode}
            {kioskVirtualCursorNode}
        </div>
    );
}
