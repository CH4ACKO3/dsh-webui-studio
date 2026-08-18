import type { StudioHarmonyInspection } from '../contracts'
import type { StudioTranslate } from './i18n'

type HarmonyTarget = StudioHarmonyInspection['targets'][number]
type HarmonyStep = HarmonyTarget['steps'][number]

export interface HarmonyTargetGroup {
  package: string
  targets: HarmonyTarget[]
  sourceOwners: string[]
}

export function groupHarmonyTargets(targets: readonly HarmonyTarget[]): HarmonyTargetGroup[] {
  const groups = new Map<string, HarmonyTargetGroup>()

  for (const target of targets) {
    let group = groups.get(target.package)
    if (group === undefined) {
      group = { package: target.package, targets: [], sourceOwners: [] }
      groups.set(target.package, group)
    }
    group.targets.push(target)
    for (const step of target.steps) {
      if (!group.sourceOwners.includes(step.owner)) group.sourceOwners.push(step.owner)
    }
  }

  return [...groups.values()]
}

function groupStepsByOwner(steps: readonly HarmonyStep[]): Array<{ owner: string; steps: HarmonyStep[] }> {
  const groups = new Map<string, HarmonyStep[]>()
  for (const step of steps) {
    const ownerSteps = groups.get(step.owner)
    if (ownerSteps === undefined) groups.set(step.owner, [step])
    else ownerSteps.push(step)
  }
  return [...groups].map(([owner, ownerSteps]) => ({ owner, steps: ownerSteps }))
}

export function HarmonyTargets({ targets, t }: {
  targets: readonly HarmonyTarget[]
  t: StudioTranslate
}): JSX.Element {
  const groups = groupHarmonyTargets(targets)

  return <section className="harmony-inspection" aria-label={t('harmonyTargets')}>
    <div className="section-heading">
      <strong>{t('materializedTargets')}</strong>
      <span>{t('targetPluginCount', { count: groups.length })} · {t('targetFileCount', { count: targets.length })}</span>
    </div>
    {targets.length === 0
      ? <p className="inspection-empty">{t('materializedTargetsEmpty')}</p>
      : <div className="harmony-target-groups">{groups.map(group => <details className="harmony-target-plugin" key={group.package}>
          <summary>
            <span className="harmony-summary-row">
              <span className="harmony-plugin-identity"><small>{t('targetPlugin')}</small><code>{group.package}</code></span>
              <span className="harmony-plugin-counts">
                <span>{t('targetFileCount', { count: group.targets.length })}</span>
                <span>{group.sourceOwners.length === 0 ? t('noAppliedPatchSteps') : t('sourcePluginCount', { count: group.sourceOwners.length })}</span>
              </span>
            </span>
          </summary>
          <div className="harmony-target-files">{group.targets.map(target => {
            const sources = groupStepsByOwner(target.steps)
            return <details className="harmony-target" key={`${target.package}:${target.file}`}>
              <summary><span className="harmony-summary-row">
                <code>{target.file}</code>
                <span>{sources.length === 0 ? t('noAppliedPatchSteps') : `${t('sourcePluginCount', { count: sources.length })} · ${t('patchStepCount', { count: target.steps.length })}`}</span>
              </span></summary>
              <div className="harmony-target-body">
                {sources.map(source => <section className="harmony-source-plugin" key={source.owner}>
                  <div className="harmony-source-heading">
                    <span><small>{t('sourcePlugin')}</small><code>{source.owner}</code></span>
                    <span>{t('patchStepCount', { count: source.steps.length })}</span>
                  </div>
                  {source.steps.map(step => <details key={`${step.owner}:${step.key}`}>
                    <summary><span className="harmony-summary-row"><code>{step.key}</code><span>{step.matches} {t('matches')}</span></span></summary>
                    <pre className="selection-code">{step.source}</pre>
                  </details>)}
                </section>)}
                <div className="harmony-source-comparison">
                  <details><summary>{t('original')}</summary><pre className="selection-code">{target.original}</pre></details>
                  <details><summary>{t('final')}</summary><pre className="selection-code">{target.final}</pre></details>
                </div>
              </div>
            </details>
          })}</div>
        </details>)}</div>}
  </section>
}
