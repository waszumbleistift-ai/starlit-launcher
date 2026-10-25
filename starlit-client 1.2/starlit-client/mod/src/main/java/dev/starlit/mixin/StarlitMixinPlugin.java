package dev.starlit.mixin;

import org.spongepowered.asm.mixin.extensibility.IMixinConfigPlugin;
import org.spongepowered.asm.mixin.extensibility.IMixinInfo;
import org.objectweb.asm.tree.ClassNode;

import java.util.List;
import java.util.Set;

/**
 * Applies the experimental sky mixins only when the user opted in with -Dstarlit.skyhooks=a|b
 * (the launcher sets it from Settings). By default no mixin of this mod is applied at all.
 */
public final class StarlitMixinPlugin implements IMixinConfigPlugin {
    @Override public void onLoad(String mixinPackage) {}
    @Override public String getRefMapperConfig() { return null; }

    @Override
    public boolean shouldApplyMixin(String targetClassName, String mixinClassName) {
        String mode = System.getProperty("starlit.skyhooks", "off").trim().toLowerCase();
        if (mixinClassName.endsWith("SkyRendererIntMixin")) return mode.equals("a");
        if (mixinClassName.endsWith("SkyRendererFloatMixin")) return mode.equals("b");
        return false;
    }

    @Override public void acceptTargets(Set<String> myTargets, Set<String> otherTargets) {}
    @Override public List<String> getMixins() { return null; }
    @Override public void preApply(String targetClassName, ClassNode targetClass, String mixinClassName, IMixinInfo mixinInfo) {}
    @Override public void postApply(String targetClassName, ClassNode targetClass, String mixinClassName, IMixinInfo mixinInfo) {}
}
