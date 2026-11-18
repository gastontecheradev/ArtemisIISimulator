import { Alarm, ProcedureId, SimState } from '../../sim/state';

/** Procedure that handles each alarm, if there is one (the electronic procedures are linked to the alarms). */
export function procedureFor(alarmId: string, s: SimState): ProcedureId | null {
  if (alarmId.startsWith('missed:')) return alarmId.slice(7) as ProcedureId;
  if (alarmId === 'cm-sep') return 'SEP_CM';
  if (alarmId === 'corridor') return s.phase === 'TRANSITO_IDA' ? 'E10' : 'E12';
  if (alarmId === 'no-return' || alarmId === 'reentry' || alarmId === 'moon-impact') return 'MAN';
  return null;
}

/** Alarms in the order of the Fault page: newest first, or warnings before cautions. */
export function sortedAlarms(s: SimState, sort: 'time' | 'class'): Alarm[] {
  const byTime = [...s.alarms].sort((a, b) => b.since - a.since);
  if (sort === 'time') return byTime;
  return byTime.sort((a, b) => (a.level === b.level ? 0 : a.level === 'WARNING' ? -1 : 1));
}
