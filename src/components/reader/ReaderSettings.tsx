import type { CSSProperties } from "react";
import { Settings2, Columns2, Square, LayoutGrid, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
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
import { useReadingPrefsStore } from "@/store/reading-prefs-store";
import { DESKTOP_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { isScreenWakeLockSupported } from "@/hooks/use-screen-wake-lock";
import { PRESET_THEMES } from "@/lib/db/presets";
import { FONT_OPTIONS } from "@/lib/db/fonts";
import type { ColumnLayout } from "@/lib/db/schema";
import { themeTint } from "@/lib/theme-colors";
import { cn } from "@/lib/utils";
// Plain import (not the `?inline` one Reader.tsx injects into the epub
// iframe) so these fonts are also loaded for the previews below, which
// render in the main document.
import "@/styles/reader-fonts.css";

export default function ReaderSettings() {
  const activeTheme = useThemeStore((s) => s.activeTheme);
  const updateActiveTheme = useThemeStore((s) => s.updateActiveTheme);
  const keepScreenOn = useReadingPrefsStore((s) => s.keepScreenOn);
  const setKeepScreenOn = useReadingPrefsStore((s) => s.setKeepScreenOn);
  // The overlay is see-through (no dim, no blur), so the page stays readable
  // while font size or spacing changes — and on a phone the panel comes up
  // from the bottom, since a side panel there would cover the very text being
  // adjusted. The overlay still catches the click/tap that closes the panel,
  // so it never reaches the page (where it would turn it).
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  // Sheet content renders through a portal to document.body, outside the
  // reader's theme-scoped subtree — same reasoning as Reader.tsx's themeVars.
  // --primary also needs overriding here (unlike Reader.tsx): the active
  // palette swatch's ring uses border-primary, and the global --primary is a
  // fixed dark color that disappears against a dark theme's own panel.
  // A touch of the text color over the page background, so the panel reads as
  // a surface above the book. It needs that instead of a border: the overlay
  // is see-through, so a panel in the page's own color would dissolve into
  // it — and a border line was what looked heavy.
  const themeVars = {
    background: themeTint(activeTheme, 5),
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
    // The font select outlines with --input (border-input) and the column
    // toggles with --border; both were the app's fixed light gray, a bright
    // ring on dark palettes.
    "--border": themeTint(activeTheme, 20),
    "--input": themeTint(activeTheme, 20),
  } as CSSProperties;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Ajustes de leitura"
          title="Ajustes de leitura"
          className="max-sm:size-11 md:w-auto md:gap-1.5 md:px-2.5"
        >
          <Settings2 />
          <span className="hidden md:inline">Ajustes</span>
        </Button>
      </SheetTrigger>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        overlayClassName="bg-transparent supports-backdrop-filter:backdrop-blur-none"
        className="data-[side=bottom]:max-h-[70dvh] data-[side=bottom]:rounded-t-2xl data-[side=bottom]:border-t-0 data-[side=bottom]:shadow-[0_-8px_24px_-8px_rgb(0_0_0/0.2)] data-[side=right]:border-l-0 data-[side=right]:shadow-[-8px_0_24px_-8px_rgb(0_0_0/0.2)]"
        style={themeVars}
      >
        <SheetHeader>
          <SheetTitle>Ajustes de leitura</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-6">
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

          {/* Duas colunas só cabem quando a área de texto tem pelo menos 800px
              (o minSpreadWidth passado ao epub.js em Reader.tsx). Descontando a
              moldura do leitor — duas setas de 48px mais 12px de respiro de cada
              lado, 120px no total — isso só acontece a partir de 920px de
              viewport. Abaixo disso o epub.js pagina em 1 coluna seja qual for o
              valor escolhido, então mostrar o controle seria oferecer um botão
              que não faz nada. O valor salvo não é alterado: quem escolheu duas
              colunas no desktop reencontra a escolha ao voltar pra lá. */}
          <div className="hidden flex-col gap-2 min-[920px]:flex">
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

          {isScreenWakeLockSupported && (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="keep-screen-on" className="cursor-pointer">
                Manter a tela acesa durante a leitura
              </Label>
              {/* Track and thumb read --input/--background, which the sheet
                  doesn't theme (only --primary, the "on" track): without
                  these the thumb stayed white on a light track in dark
                  palettes. */}
              <Switch
                id="keep-screen-on"
                className="cursor-pointer"
                style={
                  {
                    "--background": activeTheme.background,
                    "--input": `${activeTheme.textColor}40`,
                  } as CSSProperties
                }
                checked={keepScreenOn}
                onCheckedChange={setKeepScreenOn}
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
