package dev.starlit;

import dev.starlit.core.ColorMath;
import dev.starlit.core.ThemeData;
import dev.starlit.core.ThemeHolder;

/** Global access to the shared theme (colours come from the launcher, see core/ThemeData). */
public final class Starlit {
    private static final ThemeHolder THEME = ThemeHolder.fromSystemProperty();

    private Starlit() {}

    /** Current theme; re-reads the launcher's file when it changed. Cheap enough to call every frame. */
    public static ThemeData theme() { return THEME.poll(); }

    /** Colour settings store 0 for "follow the theme". */
    public static int resolve(int stored) { return stored == 0 ? theme().primary : (stored | 0xFF000000); }

    public static int panelColor(float alpha) { return ColorMath.scaleAlpha(theme().panel, alpha); }
}
