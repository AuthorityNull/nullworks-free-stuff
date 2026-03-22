# Forge UI Design Contract v1

## Purpose
Define stable semantic tokens and component aliasing so implementation can proceed without color/layout drift.

## Typography
- UI text: Inter
- Data/log/code: Geist Mono
- Decorative micro accents only: Geist Pixel

## Component alias map
- App shell: `--app-shell-bg`, `--panel-bg`, `--card-border`
- Cards: `--card-bg`, `--card-bg-elevated`, `--text`, `--muted-text`
- Side panel: `--panel-bg`, `--border`
- Buttons:
  - Primary: `--button-primary-bg`
  - Secondary: `--button-secondary-bg`
  - Destructive: `--button-danger-bg`
- Status chips: `--status-success|warning|danger|info`
- Focus ring: `--focus-ring`

## Accessibility rules
- Normal text on bg/surface must meet WCAG AA (>=4.5:1)
- Mutation actions must never rely on color-only signaling
- Focus must be visible on all interactive controls

## Motion rules
- Keep animations subtle and purposeful
- Default transition: 140-220ms, ease-out
- No looping decorative animation in dense control views

## Visual intent
Industrial, calm, data-forward. Avoid neon and avoid pure black backgrounds.
