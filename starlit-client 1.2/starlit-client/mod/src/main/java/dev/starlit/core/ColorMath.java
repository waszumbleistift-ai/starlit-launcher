package dev.starlit.core;

/** ARGB int helpers shared by the theme, the HUD and the sky module. */
public final class ColorMath {
    private ColorMath() {}

    public static int argb(int a, int r, int g, int b) { return (clamp(a) << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b); }
    public static int clamp(int v) { return Math.max(0, Math.min(255, v)); }
    public static int a(int c) { return c >>> 24; }
    public static int r(int c) { return (c >> 16) & 255; }
    public static int g(int c) { return (c >> 8) & 255; }
    public static int b(int c) { return c & 255; }

    public static int withAlpha(int color, int alpha) { return (clamp(alpha) << 24) | (color & 0x00FFFFFF); }
    /** Multiplies the alpha channel by f (0..1). */
    public static int scaleAlpha(int color, float f) { return withAlpha(color, Math.round(a(color) * Math.max(0f, Math.min(1f, f)))); }

    public static int mix(int c1, int c2, float t) {
        t = Math.max(0f, Math.min(1f, t));
        return argb(Math.round(a(c1) + (a(c2) - a(c1)) * t), Math.round(r(c1) + (r(c2) - r(c1)) * t),
            Math.round(g(c1) + (g(c2) - g(c1)) * t), Math.round(b(c1) + (b(c2) - b(c1)) * t));
    }

    public static float luminance(int c) { return (0.2126f * r(c) + 0.7152f * g(c) + 0.0722f * b(c)) / 255f; }

    /** "#rrggbb" / "rrggbb" / "#rgb" -> opaque ARGB, or fallback when invalid. */
    public static int parseHex(String s, int fallback) {
        if (s == null) return fallback;
        String h = s.trim();
        if (h.startsWith("#")) h = h.substring(1);
        if (h.length() == 3) h = "" + h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
        if (h.length() != 6) return fallback;
        try { return 0xFF000000 | Integer.parseInt(h, 16); } catch (NumberFormatException e) { return fallback; }
    }

    public static String toHex(int c) { return String.format("#%06X", c & 0xFFFFFF); }
}
