import type { MathPart } from '../math/problems'

function Part({ part }: { part: MathPart }) {
  if (part.kind === 'text') return <span>{part.value}</span>
  if (part.kind === 'sqrt') {
    return (
      <span className="math-sqrt">
        <span className="math-sqrt-sign" aria-hidden>
          √
        </span>
        <span className="math-sqrt-radicand">{part.value}</span>
      </span>
    )
  }
  return (
    <span className="math-frac" title={`${part.num}/${part.den}`}>
      <span className="math-frac-num">{part.num}</span>
      <span className="math-frac-bar" aria-hidden />
      <span className="math-frac-den">{part.den}</span>
    </span>
  )
}

export function MathPrompt({ parts, prompt }: { parts: MathPart[]; prompt: string }) {
  return (
    <p className="math-prompt" aria-label={prompt}>
      {parts.map((part, i) => (
        <Part key={i} part={part} />
      ))}
      <span className="math-prompt-eq"> = ?</span>
    </p>
  )
}
