package dev.starlit.module;

import dev.starlit.core.ColorMath;
import dev.starlit.core.SkyMath;
import dev.starlit.sky.SkyHooks;

/**
 * Sky: recolours the sky dome with presets or custom day/night colours.
 * It only changes colours, so it is cheap and holds no GPU resources; when the module is off the vanilla colour is untouched.
 * The actual hook into Minecraft's sky renderer is an experimental mixin (see README, "Sky"): it is off unless enabled in the launcher.
 */
public final class SkyModule extends Module {
    private static final float[] TYPICAL_DAY = {0.47f, 0.65f, 1.0f};

    public SkyModule() {
        super("sky", "Sky", "Recolours the sky with presets or your own colours.", Category.VISUAL);
        add(Setting.info("hook", "Sky hook", SkyModule::hookStatus));
        add(Setting.choice("preset", "Preset", SkyMath.presetNames(), 0));
        add(Setting.number("intensity", "Intensity", 80, 0, 100, 5, "%"));
        add(Setting.number("gradient", "Zenith to horizon", 40, 0, 100, 5, "%"));
        SkyMath.Preset a = SkyMath.PRESETS[0];
        add(Setting.color("dayZenith", "Day: top", a.dayZenith()));
        add(Setting.color("dayHorizon", "Day: horizon", a.dayHorizon()));
        add(Setting.color("nightZenith", "Night: top", a.nightZenith()));
        add(Setting.color("nightHorizon", "Night: horizon", a.nightHorizon()));
    }

    private static String hookStatus() {
        String mode = SkyHooks.mode();
        if (mode.equals("off")) return "Off. Enable it in the launcher: Settings, Sky hook";
        long n = SkyHooks.calls();
        return n == 0 ? "Variant " + mode.toUpperCase() + " loaded, waiting for the first frame" : "Variant " + mode.toUpperCase() + " active";
    }

    private int[] colours() {
        int p = get("preset").index();
        if (p < SkyMath.PRESETS.length) {
            SkyMath.Preset s = SkyMath.PRESETS[p];
            return new int[]{s.dayZenith(), s.dayHorizon(), s.nightZenith(), s.nightHorizon()};
        }
        return new int[]{get("dayZenith").color | 0xFF000000, get("dayHorizon").color | 0xFF000000,
            get("nightZenith").color | 0xFF000000, get("nightHorizon").color | 0xFF000000};
    }

    /** @param vanilla ARGB sky colour computed by the game */
    public int apply(int vanilla) {
        int[] c = colours();
        return SkyMath.tint(vanilla, c[0], c[1], c[2], c[3], (float) get("gradient").num / 100f, (float) get("intensity").num / 100f);
    }

    /** Per-channel variant: estimates daylight from this channel alone, so the three channels need no shared state. */
    public float applyChannel(int channel, float vanilla) {
        int[] c = colours();
        float day = Math.max(0f, Math.min(1f, vanilla / TYPICAL_DAY[channel]));
        day = day * day * (3f - 2f * day);
        float grad = (float) get("gradient").num / 100f;
        int zenith = ColorMath.mix(c[2], c[0], day), horizon = ColorMath.mix(c[3], c[1], day);
        int target = ColorMath.mix(zenith, horizon, grad);
        int shift = 16 - 8 * channel;
        float t = ((target >> shift) & 255) / 255f;
        float k = (float) get("intensity").num / 100f;
        return vanilla + (t - vanilla) * k;
    }
}
