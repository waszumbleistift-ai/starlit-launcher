package dev.starlit.module;

import com.google.gson.*;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.player.LocalPlayer;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

public final class ModuleManager {
    public static final String CODE_PREFIX = "starlit-config:";
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Path FILE = FabricLoader.getInstance().getConfigDir().resolve("starlit.json");

    public static final List<Module> MODULES = new ArrayList<>();
    public static Module accent;

    private ModuleManager() {}

    private static List<Module> create() {
        List<Module> l = new ArrayList<>();

        Module watermark = new HudModule("watermark", "Watermark", "A small Starlit tag in the corner.", 0, 0,
            mc -> List.of("Starlit"));
        watermark.enabled = true;
        l.add(watermark);

        Module fps = new HudModule("fps", "FPS", "Frames per second.", 0, 8,
            mc -> List.of(mc.getFps() + " FPS"));
        fps.enabled = true;
        l.add(fps);

        l.add(new HudModule("coords", "Coordinates", "Where you are standing.", 0, 16, mc -> {
            LocalPlayer p = mc.player;
            if (p == null) return null;
            return List.of(String.format("XYZ  %.1f  %.1f  %.1f", p.getX(), p.getY(), p.getZ()));
        }));

        l.add(new HudModule("facing", "Facing", "The direction you look.", 0, 24, mc -> {
            if (mc.player == null) return null;
            return List.of("Facing  " + mc.player.getDirection().getName());
        }));

        l.add(new HudModule("clock", "Clock", "Your real-world time.", 100, 0, mc ->
            List.of(LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss")))));

        l.add(new Keystrokes());

        l.add(new SkyModule());
        l.add(new LyricSkyModule());

        accent = new Module("accent", "Accent", "Menu accent colour. 'Theme' follows the launcher.", Category.CLIENT);
        accent.enabled = true;
        accent.settings.add(Setting.color("colour", "Colour", 0));
        l.add(accent);
        return l;
    }

    public static void init() {
        MODULES.clear();
        MODULES.addAll(create());
        load();
    }

    public static void renderHud(GuiGraphics g, Minecraft mc) {
        for (Module m : MODULES) if (m.enabled) m.renderHud(g, mc);
    }

    /** Releases threads/processes of all modules (called when the game shuts down). */
    public static void shutdown() {
        for (Module m : MODULES) m.setEnabled(false);
    }

    public static Module byId(String id) {
        for (Module m : MODULES) if (m.id.equals(id)) return m;
        return null;
    }

    public static int accentColor() { return dev.starlit.Starlit.resolve(accent.get("colour").color); }

    public static int activeCount() {
        int n = 0;
        for (Module m : MODULES) if (m.enabled) n++;
        return n;
    }

    public static void resetModule(Module m) {
        for (Module fresh : create()) if (fresh.id.equals(m.id)) m.resetToDefaults(fresh);
        save();
    }

    // ---- persistence -----------------------------------------------------

    public static JsonObject toJson() {
        JsonObject root = new JsonObject();
        for (Module m : MODULES) {
            JsonObject o = new JsonObject();
            o.addProperty("enabled", m.enabled);
            JsonObject s = new JsonObject();
            for (Setting st : m.settings) {
                switch (st.kind) {
                    case BOOL -> s.addProperty(st.key, st.bool);
                    case NUMBER, ENUM -> s.addProperty(st.key, st.num);
                    case COLOR -> s.addProperty(st.key, st.color);
                    default -> { }
                }
            }
            o.add("settings", s);
            root.add(m.id, o);
        }
        return root;
    }

    public static void fromJson(JsonObject root) {
        for (Module m : MODULES) {
            if (!root.has(m.id) || !root.get(m.id).isJsonObject()) continue;
            JsonObject o = root.getAsJsonObject(m.id);
            if (o.has("enabled")) m.setEnabled(o.get("enabled").getAsBoolean());
            if (!o.has("settings")) continue;
            JsonObject s = o.getAsJsonObject("settings");
            for (Setting st : m.settings) {
                if (!s.has(st.key)) continue;
                try {
                    switch (st.kind) {
                        case BOOL -> st.bool = s.get(st.key).getAsBoolean();
                        case NUMBER, ENUM -> st.setNumber(s.get(st.key).getAsDouble());
                        case COLOR -> st.color = s.get(st.key).getAsInt();
                        default -> { }
                    }
                } catch (RuntimeException ignored) {}
            }
        }
    }

    public static void save() {
        try {
            Files.writeString(FILE, GSON.toJson(toJson()));
        } catch (Exception e) {
            System.err.println("[Starlit] could not save config: " + e);
        }
    }

    private static void load() {
        try {
            if (Files.exists(FILE)) fromJson(JsonParser.parseString(Files.readString(FILE)).getAsJsonObject());
        } catch (Exception e) {
            System.err.println("[Starlit] could not read config, using defaults: " + e);
        }
    }

    // ---- share codes ------------------------------------------------------

    public static String exportCode() {
        try {
            byte[] raw = new Gson().toJson(toJson()).getBytes(StandardCharsets.UTF_8);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            try (GZIPOutputStream gz = new GZIPOutputStream(bos)) { gz.write(raw); }
            return CODE_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(bos.toByteArray());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** @return true if the code was valid and has been applied. */
    public static boolean importCode(String code) {
        try {
            code = code.trim();
            if (!code.startsWith(CODE_PREFIX)) return false;
            byte[] zipped = Base64.getUrlDecoder().decode(code.substring(CODE_PREFIX.length()));
            try (GZIPInputStream gz = new GZIPInputStream(new ByteArrayInputStream(zipped))) {
                String json = new String(gz.readAllBytes(), StandardCharsets.UTF_8);
                fromJson(JsonParser.parseString(json).getAsJsonObject());
            }
            save();
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
