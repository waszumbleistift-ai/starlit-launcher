package dev.starlit.module;

public enum Category {
    HUD("HUD", "Widgets on your screen"),
    VISUAL("Visual", "The sky and floating lyrics"),
    CLIENT("Client", "Look and feel of Starlit");

    public final String label;
    public final String blurb;

    Category(String label, String blurb) {
        this.label = label;
        this.blurb = blurb;
    }
}
