import type { ChemDisplay, FormulaPart } from '../chem/problems'

function Formula({ parts }: { parts: FormulaPart[] }) {
  return (
    <span className="chem-formula" aria-hidden>
      {parts.map((part, i) =>
        part.kind === 'sub' ? (
          <sub key={i}>{part.value}</sub>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </span>
  )
}

export function ChemPrompt({ display, prompt }: { display: ChemDisplay; prompt: string }) {
  return (
    <div className="chem-prompt" aria-label={prompt}>
      {display.kind === 'symbol' && (
        <>
          <span className="chem-prompt-label">Element symbol</span>
          <p className="chem-prompt-hero">{display.value}</p>
        </>
      )}
      {display.kind === 'name' && (
        <>
          <span className="chem-prompt-label">Element</span>
          <p className="chem-prompt-hero chem-prompt-name">{display.value}</p>
        </>
      )}
      {display.kind === 'formula' && (
        <>
          <span className="chem-prompt-label">Chemical formula</span>
          <p className="chem-prompt-hero">
            <Formula parts={display.parts} />
          </p>
        </>
      )}
    </div>
  )
}
