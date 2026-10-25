package dev.starlit.mixin;

import dev.starlit.sky.SkyHooks;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/** Variant A: SkyRenderer.renderSkyDisc(int skyColorArgb). Only applied with -Dstarlit.skyhooks=a. */
@Pseudo
@Mixin(targets = "net.minecraft.client.renderer.SkyRenderer")
public abstract class SkyRendererIntMixin {
    @ModifyVariable(method = "renderSkyDisc", at = @At("HEAD"), argsOnly = true, require = 0)
    private int starlit$tint(int color) {
        return SkyHooks.tintArgb(color);
    }
}
