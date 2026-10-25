package dev.starlit.core;

/** Colour logic for the Sky module, free of Minecraft types so it can be tested. */
public final class SkyMath {
    public record Preset(String name, int dayZenith, int dayHorizon, int nightZenith, int nightHorizon) {}

    public static final Preset[] PRESETS = {
        new Preset("Aurora", 0xFF8A5CFF, 0xFFE0A8FF, 0xFF160838, 0xFF3A1F86),
        new Preset("Dusk", 0xFFFF7A9C, 0xFFFFC27A, 0xFF1C0A2E, 0xFF5A2A6E),
        new Preset("Nebula", 0xFF6F7DFF, 0xFFB38CFF, 0xFF0B0B2E, 0xFF2C2A7A),
        new Preset("Ocean", 0xFF3FB6FF, 0xFFBDF1FF, 0xFF041633, 0xFF0E4A78),
    };

    private SkyMath() {}

    public static String[] presetNames() {
        String[] n = new String[PRESETS.length + 1];
        for (int i = 0; i < PRESETS.length; i++) n[i] = PRESETS[i].name();
        n[PRESETS.length] = "Custom";
        return n;
    }

    /** 0 = night, 1 = day, derived from the brightness of the vanilla sky colour (works with weather, other dimensions, time changes). */
    public static float daylight(int vanillaSky) {
        float l = ColorMath.luminance(vanillaSky);
        float t = Math.max(0f, Math.min(1f, (l - 0.03f) / (0.42f - 0.03f)));
        return t * t * (3f - 2f * t);
    }

    /**
     * Colour for the sky dome.
     * @param gradient 0 = zenith colour only, 1 = fully the horizon colour
     * @param intensity 0 = vanilla sky, 1 = fully the preset
     */
    public static int tint(int vanillaSky, int dayZenith, int dayHorizon, int nightZenith, int nightHorizon, float gradient, float intensity) {
        float day = daylight(vanillaSky);
        int zenith = ColorMath.mix(nightZenith, dayZenith, day);
        int horizon = ColorMath.mix(nightHorizon, dayHorizon, day);
        int target = ColorMath.mix(zenith, horizon, gradient);
        return ColorMath.mix(vanillaSky, target, intensity) | 0xFF000000;
    }
}
