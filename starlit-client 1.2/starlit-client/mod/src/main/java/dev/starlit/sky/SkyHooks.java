package dev.starlit.sky;

import dev.starlit.module.ModuleManager;
import dev.starlit.module.SkyModule;

/**
 * Entry points called from the (optional, experimental) sky mixins. They must never throw:
 * on any problem the vanilla colour is returned unchanged.
 */
public final class SkyHooks {
    private static volatile long calls;

    private SkyHooks() {}

    /** "off", "a" or "b" - set with -Dstarlit.skyhooks (the launcher does this from its settings). */
    public static String mode() {
        String m = System.getProperty("starlit.skyhooks", "off").trim().toLowerCase();
        return m.equals("a") || m.equals("b") ? m : "off";
    }

    public static long calls() { return calls; }

    private static SkyModule module() {
        var m = ModuleManager.byId("sky");
        return m instanceof SkyModule s && s.enabled ? s : null;
    }

    /** Variant A: the sky colour arrives as one ARGB int. */
    public static int tintArgb(int vanilla) {
        calls++;
        try {
            SkyModule s = module();
            return s == null ? vanilla : s.apply(vanilla);
        } catch (RuntimeException e) { return vanilla; }
    }

    /** Variant B: the sky colour arrives as three floats (0..1); each channel is tinted separately. */
    public static float tintChannel(int channel, float vanilla) {
        calls++;
        try {
            SkyModule s = module();
            return s == null ? vanilla : s.applyChannel(channel, vanilla);
        } catch (RuntimeException e) { return vanilla; }
    }
}
