import { useState } from 'react'

interface AuthFieldProps {
  name: string
  label: string
  type: 'email' | 'password'
  autoComplete: string
  error?: string
  hint?: string
}

export function AuthField({ name, label, type, autoComplete, error, hint }: AuthFieldProps) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="auth-field">
      <label htmlFor={name}>{label}</label>
      {hint && <p className="field-hint" id={`${name}-hint`}>{hint}</p>}
      <div className="input-row">
        <input id={name} name={name} type={type === 'password' && visible ? 'text' : type}
          autoComplete={autoComplete} required aria-invalid={Boolean(error)}
          aria-describedby={[hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(' ') || undefined} />
        {type === 'password' && <button className="password-toggle" type="button" aria-pressed={visible}
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} onClick={() => setVisible((value) => !value)}>
          {visible ? 'Hide' : 'Show'}
        </button>}
      </div>
      {error && <p className="field-error" id={`${name}-error`}>{error}</p>}
    </div>
  )
}
