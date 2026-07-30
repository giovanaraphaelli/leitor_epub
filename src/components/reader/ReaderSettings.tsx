import type { CSSProperties } from "react";
import { Settings2, Columns2, Square, LayoutGrid, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useThemeStore } from "@/store/theme-store";
import { PRESET_THEMES } from "@/lib/db/presets";
import { FONT_OPTIONS } from "@/lib/db/fonts";
import type { ColumnLayout } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
// Plain import (not the `?url` one Reader.tsx uses to inject into the epub
// iframe) so these fonts are also loaded for the previews below, which
// render in the main document.
import "@/styles/reader-fonts.css";

export default function ReaderSettings() {
  const activeTheme = useThemeStore((s) => s.activeTheme);
  const updateActiveTheme = useThemeStore((s) => s.updateActiveTheme);

  // Sheet content renders through a portal to document.body, outside the
  // reader's theme-scoped subtree — same reasoning as Reader.tsx's themeVars.
  // --primary also needs overriding here (unlike Reader.tsx): the active
  // palette swatch's ring uses border-primary, and the global --primary is a
  // fixed dark color that disappears against a dark theme's own panel.
  const themeVars = {
    background: activeTheme.background,
    color: activeTheme.textColor,
    "--foreground": activeTheme.textColor,
    "--muted-foreground": activeTheme.textColor,
    "--muted": `${activeTheme.textColor}1a`,
    "--primary": activeTheme.textColor,
    // Select's dropdown items highlight with --accent/--accent-foreground on
    // hover/focus, while the Colunas toggle group highlights its selected
    // state with --muted/--foreground — mirroring those same values here
    // keeps the two controls' highlight colors consistent with each other.
    "--accent": `${activeTheme.textColor}1a`,
    "--accent-foreground": activeTheme.textColor,
  } as CSSProperties;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Ajustes de leitura">
          <Settings2 />
        </Button>
      </SheetTrigger>
      <SheetContent style={themeVars}>
        <SheetHeader>
          <SheetTitle>Ajustes de leitura</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4">
          <div className="flex flex-col gap-2">
            <Label>Paleta</Label>
            <div className="flex flex-wrap items-center gap-3">
              {PRESET_THEMES.map((preset) => {
                const isActive = activeTheme.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-label={preset.name}
                    title={preset.name}
                    onClick={() =>
                      updateActiveTheme({
                        id: preset.id,
                        name: preset.name,
                        background: preset.background,
                        textColor: preset.textColor,
                        isPreset: preset.isPreset,
                      })
                    }
                    className={cn(
                      "flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors",
                      // Pastel/white/near-black swatches can blend into a
                      // similarly colored sheet background — a neutral
                      // border keeps every swatch visible regardless of its
                      // own color, not just the currently selected one.
                      isActive
                        ? "border border-primary/80"
                        : "border border-muted-foreground/50",
                    )}
                    style={{ background: preset.background }}
                  >
                    {isActive && (
                      <Check
                        className="size-4"
                        style={{ color: preset.textColor }}
                      />
                    )}
                  </button>
                );
              })}

              {/* "+" creates a one-off custom palette seeded from whatever
                  colors are currently active, then reveals the two pickers
                  below to actually change them — same swatch slot doubles as
                  the active-state indicator once selected, just like a
                  preset. There's only ever one custom slot for now: saving
                  several named custom palettes is a separate, not-yet-built
                  roadmap item. */}
              <button
                type="button"
                aria-label="Nova paleta personalizada"
                title="Nova paleta personalizada"
                onClick={() => {
                  if (activeTheme.id !== "custom") {
                    updateActiveTheme({ id: "custom", name: "Personalizado", isPreset: false });
                  }
                }}
                className={cn(
                  "flex size-9 cursor-pointer items-center justify-center rounded-full border transition-colors",
                  activeTheme.id === "custom"
                    ? "border-primary/80"
                    : "border-dashed border-muted-foreground/50",
                )}
                style={activeTheme.id === "custom" ? { background: activeTheme.background } : undefined}
              >
                {activeTheme.id === "custom" ? (
                  <Check className="size-4" style={{ color: activeTheme.textColor }} />
                ) : (
                  <Plus className="size-4 text-muted-foreground" />
                )}
              </button>

              {activeTheme.id === "custom" && (
                <>
                  <label className="flex cursor-pointer flex-col items-center gap-1 text-xs text-muted-foreground">
                    Fundo
                    <input
                      type="color"
                      value={activeTheme.background}
                      onChange={(e) => updateActiveTheme({ background: e.target.value })}
                      className="size-9 cursor-pointer rounded-full border border-muted-foreground/50 bg-transparent p-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:rounded-full [&::-webkit-color-swatch-wrapper]:p-0"
                    />
                  </label>
                  <label className="flex cursor-pointer flex-col items-center gap-1 text-xs text-muted-foreground">
                    Texto
                    <input
                      type="color"
                      value={activeTheme.textColor}
                      onChange={(e) => updateActiveTheme({ textColor: e.target.value })}
                      className="size-9 cursor-pointer rounded-full border border-muted-foreground/50 bg-transparent p-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:rounded-full [&::-webkit-color-swatch-wrapper]:p-0"
                    />
                  </label>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Fonte</Label>
            <Select
              value={activeTheme.fontFamily}
              onValueChange={(value) => updateActiveTheme({ fontFamily: value })}
            >
              <SelectTrigger className="w-full" style={{ fontFamily: activeTheme.fontFamily }}>
                <SelectValue />
              </SelectTrigger>
              {/* Radix portals this to document.body, outside the sheet's own
                  DOM subtree, so it needs the theme vars applied again — CSS
                  custom properties don't cross a portal boundary. */}
              <SelectContent style={themeVars}>
                {FONT_OPTIONS.map((font) => (
                  <SelectItem key={font.value} value={font.value} style={{ fontFamily: font.value }}>
                    {font.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Colunas</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={activeTheme.columns}
              onValueChange={(value) => {
                if (value)
                  updateActiveTheme({ columns: value as ColumnLayout });
              }}
            >
              <ToggleGroupItem value="single" aria-label="Uma coluna">
                <Square /> 1
              </ToggleGroupItem>
              <ToggleGroupItem value="double" aria-label="Duas colunas">
                <Columns2 /> 2
              </ToggleGroupItem>
              <ToggleGroupItem value="auto" aria-label="Automático">
                <LayoutGrid /> Auto
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Tamanho da fonte ({activeTheme.fontSize}px)</Label>
            <Slider
              value={[activeTheme.fontSize]}
              min={12}
              max={32}
              step={1}
              onValueChange={([value]) =>
                updateActiveTheme({ fontSize: value })
              }
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>
              Espaçamento entre linhas ({activeTheme.lineHeight.toFixed(1)})
            </Label>
            <Slider
              value={[activeTheme.lineHeight]}
              min={1.2}
              max={2.2}
              step={0.1}
              onValueChange={([value]) =>
                updateActiveTheme({ lineHeight: value })
              }
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
