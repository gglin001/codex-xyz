import { Cpu, Gauge, PanelsRightBottom, SlidersHorizontal, Zap } from "lucide-react"
import { memo } from "react"
import { cn } from "../classNames.js"
import type { ParameterState, RuntimeEnvironment, WorkbenchSession } from "./workbenchTypes.js"

export type ParamPanelProps = {
  className?: string
  collapsed?: boolean
  session: WorkbenchSession | null
  params: ParameterState
  contextTokens: number
  contextLimit: number
  onParamChange: (params: ParameterState) => void
  onCollapseToggle?: () => void
}

const runtimeOptions: RuntimeEnvironment[] = ["Python", "Node", "Bash"]
const modelOptions = ["codex", "codex-large", "codex-fast"]

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(value)
}

function sliderBackground(value: number, min: number, max: number) {
  const progress = ((value - min) / (max - min)) * 100
  return {
    background: `linear-gradient(90deg, #10b981 ${progress}%, rgba(30, 41, 59, 0.9) ${progress}%)`
  }
}

const fieldClass =
  "h-9 w-full rounded-md border border-slate-800/80 bg-slate-950/70 px-3 text-[13px] font-medium text-slate-100 outline-none transition duration-150 ease-out hover:border-slate-700 focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/10"

const sectionClass = "border-b border-slate-800/60 px-4 py-4 last:border-b-0"

type SliderControlProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  displayValue: string
  onChange: (value: number) => void
}

const SliderControl = memo(function SliderControl({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange
}: SliderControlProps) {
  return (
    <label className="grid gap-2">
      <span className="flex items-center justify-between gap-3 text-[12px]">
        <span className="font-medium text-slate-300">{label}</span>
        <span className="font-mono text-[11px] text-slate-500">{displayValue}</span>
      </span>
      <input
        className="h-1.5 cursor-pointer appearance-none rounded-full accent-emerald-500 outline-none [--thumb-size:14px] [&::-moz-range-thumb]:h-[var(--thumb-size)] [&::-moz-range-thumb]:w-[var(--thumb-size)] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-slate-950 [&::-moz-range-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:h-[var(--thumb-size)] [&::-webkit-slider-thumb]:w-[var(--thumb-size)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-950 [&::-webkit-slider-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(16,185,129,0.12)]"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={sliderBackground(value, min, max)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
})

export const ParamPanel = memo(function ParamPanel({
  className,
  collapsed = false,
  session,
  params,
  contextTokens,
  contextLimit,
  onParamChange,
  onCollapseToggle
}: ParamPanelProps) {
  const tokenRatio = contextLimit > 0 ? clamp(contextTokens / contextLimit, 0, 1) : 0
  const tokenPercent = Math.round(tokenRatio * 100)

  if (collapsed) {
    return (
      <aside className={cn("hidden h-full border-l border-slate-800/80 bg-slate-950/70 xl:flex xl:w-[56px] xl:flex-col xl:items-center xl:py-3", className)}>
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-800/80 bg-slate-900/70 text-slate-400 transition duration-150 ease-out hover:border-slate-700 hover:bg-slate-800/70 hover:text-slate-100"
          title="Open parameters"
          aria-label="Open parameters"
          onClick={onCollapseToggle}
        >
          <SlidersHorizontal size={17} />
        </button>
      </aside>
    )
  }

  return (
    <aside className={cn("flex h-full min-h-0 flex-col border-l border-slate-800/80 bg-slate-950/80 text-slate-200", className)}>
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/75 px-4 backdrop-blur-md">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold text-slate-100">Session Parameters</h2>
          <p className="truncate text-[11px] text-slate-500">{session?.model ?? params.model} runtime profile</p>
        </div>
        {onCollapseToggle ? (
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition duration-150 ease-out hover:bg-slate-800/60 hover:text-slate-100"
            title="Collapse parameters"
            aria-label="Collapse parameters"
            onClick={onCollapseToggle}
          >
            <PanelsRightBottom size={16} />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className={sectionClass}>
          <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <Cpu size={14} />
            Model
          </div>
          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-[12px] font-medium text-slate-300">Model</span>
              <select
                className={fieldClass}
                value={params.model}
                onChange={(event) => onParamChange({ ...params, model: event.target.value })}
              >
                {modelOptions.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-[12px] font-medium text-slate-300">Runtime</span>
              <select
                className={fieldClass}
                value={params.runtime}
                onChange={(event) =>
                  onParamChange({
                    ...params,
                    runtime: event.target.value as RuntimeEnvironment
                  })
                }
              >
                {runtimeOptions.map((runtime) => (
                  <option key={runtime} value={runtime}>
                    {runtime}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className={sectionClass}>
          <div className="mb-4 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <SlidersHorizontal size={14} />
            Generation
          </div>
          <div className="grid gap-5">
            <SliderControl
              label="Temperature"
              value={params.temperature}
              min={0}
              max={1}
              step={0.01}
              displayValue={params.temperature.toFixed(2)}
              onChange={(temperature) => onParamChange({ ...params, temperature })}
            />
            <SliderControl
              label="Max tokens"
              value={params.maxTokens}
              min={1024}
              max={128000}
              step={1024}
              displayValue={formatCompact(params.maxTokens)}
              onChange={(maxTokens) => onParamChange({ ...params, maxTokens })}
            />
            <SliderControl
              label="Reasoning depth"
              value={params.reasoning}
              min={0}
              max={100}
              step={1}
              displayValue={`${params.reasoning}%`}
              onChange={(reasoning) => onParamChange({ ...params, reasoning })}
            />
          </div>
        </section>

        <section className={sectionClass}>
          <div className="mb-4 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <Gauge size={14} />
            Context Window
          </div>
          <div className="rounded-md border border-slate-800/80 bg-slate-900/40 p-3">
            <div className="mb-2 flex items-center justify-between text-[12px]">
              <span className="font-medium text-slate-300">Token limit</span>
              <span className="font-mono text-[11px] text-slate-500">
                {formatCompact(contextTokens)} / {formatCompact(contextLimit)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800/80">
              <div
                className={cn(
                  "h-full rounded-full transition-[width,background-color] duration-300 ease-out",
                  tokenRatio > 0.82 ? "bg-violet-500" : "bg-emerald-500"
                )}
                style={{ width: `${tokenPercent}%` }}
              />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
              <span>Input 42%</span>
              <span>Tools 18%</span>
              <span>Output {Math.max(0, 100 - tokenPercent)}%</span>
            </div>
          </div>
        </section>

        <section className={sectionClass}>
          <button
            type="button"
            className={cn(
              "flex h-10 w-full items-center justify-between rounded-md border px-3 text-left transition duration-150 ease-out",
              params.autoRun
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                : "border-slate-800/80 bg-slate-900/40 text-slate-300 hover:border-slate-700 hover:bg-slate-800/50"
            )}
            aria-pressed={params.autoRun}
            onClick={() => onParamChange({ ...params, autoRun: !params.autoRun })}
          >
            <span className="inline-flex items-center gap-2 text-[13px] font-medium">
              <Zap size={15} />
              Auto-run commands
            </span>
            <span
              className={cn(
                "relative h-5 w-9 rounded-full border transition duration-150 ease-out",
                params.autoRun ? "border-emerald-400/50 bg-emerald-400/20" : "border-slate-700 bg-slate-950"
              )}
            >
              <span
                className={cn(
                  "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition duration-150 ease-out",
                  params.autoRun ? "left-[18px] bg-emerald-300" : "left-0.5 bg-slate-500"
                )}
              />
            </span>
          </button>
        </section>
      </div>
    </aside>
  )
})
