import type { CSSProperties } from "react";
import { Settings2, Columns2, Square, LayoutGrid, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useThemeStore } from "@/store/theme-store";
import { PRESET_THEMES } from "@/lib/db/presets";
import type { ColumnLayout } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

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
            <div className="flex flex-wrap gap-3">
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
                        fontFamily: preset.fontFamily,
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
            </div>
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
