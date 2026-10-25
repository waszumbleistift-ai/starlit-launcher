package dev.starlit.core;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/**
 * The theme shared with the launcher (theme.json written by the launcher, see launcher/src/shared/theme.js).
 * Immutable; invalid or missing values fall back to the Aurora defaults.
 */
public final class ThemeData {
    public final int primary, secondary, accent, background, panel, border, text, muted, button, buttonHover, on, off, selected, onPrimary;
    public final float glow, gradient, aurora;
    public final String name;

    private ThemeData(Map<String, Object> colors, Map<String, Object> effects, String name, String onPrimaryHex) {
        this.name = name;
        primary = c(colors, "primary", 0xFFB44CFF);
        secondary = c(colors, "secondary", 0xFFFF6FD8);
        accent = c(colors, "accent", 0xFF4FE0E8);
        background = c(colors, "background", 0xFF0B0614);
        panel = c(colors, "panel", 0xFF180E2C);
        border = c(colors, "border", 0xFFFFFFFF);
        text = c(colors, "text", 0xFFF4EFFC);
        muted = c(colors, "muted", 0xFFA395C4);
        button = c(colors, "button", 0xFFFFFFFF);
        buttonHover = c(colors, "buttonHover", 0xFFFFFFFF);
        on = c(colors, "on", 0xFF5BE3B0);
        off = c(colors, "off", 0xFFFFFFFF);
        selected = c(colors, "selected", 0xFFB44CFF);
        onPrimary = ColorMath.parseHex(onPrimaryHex, ColorMath.luminance(primary) > 0.65f ? 0xFF12081F : 0xFFFFFFFF);
        glow = f(effects, "glow", 0.6f);
        gradient = f(effects, "gradient", 1f);
        aurora = f(effects, "aurora", 1f);
    }

    private static int c(Map<String, Object> m, String k, int def) {
        Object v = m == null ? null : m.get(k);
        return v instanceof String ? ColorMath.parseHex((String) v, def) : def;
    }

    private static float f(Map<String, Object> m, String k, float def) {
        Object v = m == null ? null : m.get(k);
        return v instanceof Number ? Math.max(0f, Math.min(1f, ((Number) v).floatValue())) : def;
    }

    public static ThemeData defaults() { return new ThemeData(null, null, "Aurora", null); }

    /** Never throws: broken JSON yields the defaults. */
    public static ThemeData parse(String json) {
        try {
            Object root = MiniJson.parse(json);
            return new ThemeData(MiniJson.object(MiniJson.object(root).get("colors")), MiniJson.object(MiniJson.object(root).get("effects")),
                MiniJson.str(root, "name") == null ? "Custom" : MiniJson.str(root, "name"), MiniJson.str(root, "onPrimary"));
        } catch (RuntimeException e) {
            return defaults();
        }
    }

    public static ThemeData load(Path file) {
        try { return parse(Files.readString(file)); } catch (Exception e) { return defaults(); }
    }
}
