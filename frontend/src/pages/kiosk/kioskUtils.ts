export function getFoodFallbackSvg(name: string, isVeg: boolean): string {
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

export function getFoodImage(name: string, isVeg: boolean): string {
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

export const CARTOON_VIDEOS = [
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

export const ORDER_STAGES = ["NEW", "ACCEPTED", "PREPARING", "READY", "SERVED"];

export function playHappyBirthdayMelody(): () => void {
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
