import {
  cloneElement,
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react'
import { nextCompositeIndex, type CompositeNavigationKey } from './composite'
import { useStudioTheme, type StudioThemePreference } from './theme'

function classes(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ControlSize = 'small' | 'medium'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ControlSize
  loading?: boolean
  loadingLabel?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'secondary',
  size = 'medium',
  loading = false,
  loadingLabel,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}, ref) {
  return <button {...props} ref={ref} type={type} disabled={disabled || loading}
    aria-busy={loading || undefined} data-variant={variant} data-size={size} data-loading={loading || undefined}
    className={classes('studio-ui-button', className)}>
    {loading && <span className="studio-ui-spinner" aria-hidden="true" />}
    <span>{loading && loadingLabel !== undefined ? loadingLabel : children}</span>
  </button>
})

export interface IconButtonProps extends Omit<ButtonProps, 'loadingLabel'> {
  label: string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  label,
  className,
  children,
  ...props
}, ref) {
  return <Button {...props} ref={ref} aria-label={label} title={label}
    className={classes('studio-ui-icon-button', className)}>{children}</Button>
})

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: 'aside' | 'section'
}

export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel({
  as: Element = 'section',
  className,
  ...props
}, ref) {
  return <Element {...props} ref={ref} className={classes('studio-ui-panel', className)} />
})

export function PanelHeader({
  title,
  description,
  actions,
  level = 2,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  level?: 1 | 2 | 3
}): JSX.Element {
  const Heading = `h${level}` as const
  return <header {...props} className={classes('studio-ui-panel-header', className)}>
    <div className="studio-ui-panel-heading"><Heading>{title}</Heading>{description !== undefined && <p>{description}</p>}</div>
    {actions !== undefined && <div className="studio-ui-panel-actions">{actions}</div>}
  </header>
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div {...props} className={classes('studio-ui-panel-body', className)} />
}

export interface TabOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
}

export function Tabs<T extends string>({
  id,
  label,
  options,
  value,
  onChange,
  className,
}: {
  id: string
  label: string
  options: readonly TabOption<T>[]
  value: T
  onChange(value: T): void
  className?: string
}): JSX.Element {
  const selectByKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const keys: CompositeNavigationKey[] = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (!keys.includes(event.key as CompositeNavigationKey)) return
    event.preventDefault()
    const disabled = new Set(options.flatMap((option, optionIndex) => option.disabled ? [optionIndex] : []))
    const next = nextCompositeIndex(index, options.length, event.key as CompositeNavigationKey, disabled)
    const option = options[next]
    if (option === undefined) return
    onChange(option.value)
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return <div className={classes('studio-ui-tabs', className)} role="tablist" aria-label={label}>
    {options.map((option, index) => <button key={option.value} id={`${id}-tab-${option.value}`} type="button"
      role="tab" aria-selected={value === option.value} aria-controls={`${id}-panel-${option.value}`}
      tabIndex={value === option.value ? 0 : -1} disabled={option.disabled}
      onClick={() => onChange(option.value)} onKeyDown={event => selectByKeyboard(event, index)}>
      {option.label}
    </button>)}
  </div>
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string
  options: readonly TabOption<T>[]
  value: T
  onChange(value: T): void
  className?: string
}): JSX.Element {
  const selectByKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const keys: CompositeNavigationKey[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(event.key as CompositeNavigationKey)) return
    event.preventDefault()
    const disabled = new Set(options.flatMap((option, optionIndex) => option.disabled ? [optionIndex] : []))
    const next = nextCompositeIndex(index, options.length, event.key as CompositeNavigationKey, disabled)
    const option = options[next]
    if (option === undefined) return
    onChange(option.value)
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return <div className={classes('studio-ui-segmented', className)} role="radiogroup" aria-label={label}>
    {options.map((option, index) => <button key={option.value} type="button" role="radio"
      aria-checked={value === option.value} tabIndex={value === option.value ? 0 : -1} disabled={option.disabled}
      onClick={() => onChange(option.value)} onKeyDown={event => selectByKeyboard(event, index)}>
      {option.label}
    </button>)}
  </div>
}

const themeOptions: readonly TabOption<StudioThemePreference>[] = [
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
]

export function ThemeSwitcher({
  label = 'Color theme',
  labels,
  className,
}: {
  label?: string
  labels?: Partial<Record<StudioThemePreference, ReactNode>>
  className?: string
}): JSX.Element {
  const { preference, setPreference } = useStudioTheme()
  const options = themeOptions.map(option => ({ ...option, label: labels?.[option.value] ?? option.label }))
  return <SegmentedControl label={label} options={options} value={preference} onChange={setPreference}
    className={classes('studio-ui-theme-switcher', className)} />
}

export function FormField({
  id,
  label,
  description,
  error,
  required,
  children,
  className,
}: {
  id: string
  label: ReactNode
  description?: ReactNode
  error?: ReactNode
  required?: boolean
  children: ReactElement<{
    id?: string
    required?: boolean
    'aria-describedby'?: string
    'aria-invalid'?: boolean | 'true' | 'false'
  }>
  className?: string
}): JSX.Element {
  const describedBy = [
    children.props['aria-describedby'],
    description === undefined ? undefined : `${id}-description`,
    error === undefined ? undefined : `${id}-error`,
  ].filter((value): value is string => value !== undefined).join(' ') || undefined
  const control = cloneElement(children, {
    id,
    required: children.props.required ?? required,
    'aria-describedby': describedBy,
    'aria-invalid': error === undefined ? children.props['aria-invalid'] : true,
  })

  return <div className={classes('studio-ui-field', className)} data-invalid={error !== undefined || undefined}>
    <label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>
    {control}
    {description !== undefined && <p id={`${id}-description`}>{description}</p>}
    {error !== undefined && <p id={`${id}-error`} className="studio-ui-field-error" role="alert">{error}</p>}
  </div>
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({
  className,
  ...props
}, ref) {
  return <input {...props} ref={ref} className={classes('studio-ui-input', className)} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({
  className,
  ...props
}, ref) {
  return <select {...props} ref={ref} className={classes('studio-ui-input', 'studio-ui-select', className)} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({
  className,
  ...props
}, ref) {
  return <textarea {...props} ref={ref} className={classes('studio-ui-input', 'studio-ui-textarea', className)} />
})

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export function Status({
  tone = 'neutral',
  children,
  label,
  className,
}: {
  tone?: StatusTone
  children: ReactNode
  label?: string
  className?: string
}): JSX.Element {
  return <span className={classes('studio-ui-status', className)} data-tone={tone}
    aria-label={label} role={label === undefined ? undefined : 'status'}>
    <span className="studio-ui-status-dot" aria-hidden="true" />{children}
  </span>
}

export function Badge({
  tone = 'neutral',
  children,
  className,
}: { tone?: StatusTone; children: ReactNode; className?: string }): JSX.Element {
  return <span className={classes('studio-ui-badge', className)} data-tone={tone}>{children}</span>
}

export function Notice({
  tone = 'info',
  children,
  className,
}: { tone?: Exclude<StatusTone, 'neutral'>; children: ReactNode; className?: string }): JSX.Element {
  return <div className={classes('studio-ui-notice', className)} data-tone={tone}
    role={tone === 'danger' ? 'alert' : 'status'}>{children}</div>
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }): JSX.Element {
  const titleId = useId()
  return <section className={classes('studio-ui-empty', className)} aria-labelledby={titleId}>
    <strong id={titleId}>{title}</strong>
    {description !== undefined && <p>{description}</p>}
    {action !== undefined && <div>{action}</div>}
  </section>
}
