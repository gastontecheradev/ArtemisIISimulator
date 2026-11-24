import { useState } from 'react';
import { FLYBY_ALTITUDE_TARGET } from '../sim/constants';
import { formatDuration, formatNumber, formatTMinus } from '../sim/format';
import { COUNT_START } from '../sim/mission/countdown';
import { MISSION_PARAMS } from '../sim/mission/params';
import { useLocale, useT } from './i18n';
import { DEMO_WARP, setIntro, startMission } from './store';

/** Start screen: what it is, how to fly it and how to begin (always on the pad, at T‑10 min). */
export function StartScreen({ onCredits }: { onCredits: () => void }): JSX.Element {
  const t = useT();
  const [autoCrew, setAutoCrew] = useState(false);
  const n = MISSION_PARAMS.nominal;
  // The mission and the demonstration start at the start of the terminal count.
  const t0 = formatTMinus(COUNT_START, useLocale());
  return (
    <div className="modal intro">
      <div className="modal-card intro-card">
        <h2>ARTEMIS II SIMULATOR</h2>
        <p>{t('start.intro')}</p>
        <dl className="end-stats">
          <dt>{t('start.flyby')}</dt>
          <dd>{formatNumber(FLYBY_ALTITUDE_TARGET)} km</dd>
          <dt>{t('start.duration')}</dt>
          <dd>{formatDuration(n.eiMet)}</dd>
        </dl>
        <h3>{t('start.how')}</h3>
        <ol className="intro-steps">
          <li>{t('start.step1', { t0 })}</li>
          <li>{t('start.step2')}</li>
          <li>{t('start.step3')}</li>
        </ol>
        <p className="dim">{t('start.keys')}</p>
        <label className="intro-check">
          <input type="checkbox" checked={autoCrew} onChange={(e) => setAutoCrew(e.target.checked)} />
          {t('start.demo', { t0, warp: DEMO_WARP })}
        </label>
        <div className="end-actions">
          <button className="tb-btn on" onClick={() => startMission({ autoCrew, tutorial: false })}>
            {t('start.go')}
          </button>
          <button className="tb-btn" onClick={() => startMission({ autoCrew: false, tutorial: true })}>
            {t('start.tutorial')}
          </button>
          <button className="tb-btn" onClick={() => setIntro('guides')}>
            {t('start.guides')}
          </button>
          <button className="tb-btn" onClick={onCredits}>
            {t('start.credits')}
          </button>
        </div>
        <p className="dim intro-foot">{t('start.foot')}</p>
      </div>
    </div>
  );
}
