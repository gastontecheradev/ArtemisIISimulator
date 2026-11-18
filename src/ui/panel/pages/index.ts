import { FC } from 'react';
import { SimState } from '../../../sim/state';
import { Burn, burnActions } from './Burn';
import { CommSum } from './CommSum';
import { Fault, faultActions } from './Fault';
import { FlightTraj } from './FlightTraj';
import { Pfd, pfdActions } from './Pfd';
import { Procs, procsActions } from './Procs';
import { PropSys } from './PropSys';
import { SysSum } from './SysSum';
import { Timeline } from './Timeline';

export type PageId = 'PFD' | 'TRAJ' | 'BURN' | 'PROCS' | 'TL' | 'SUM' | 'FAULT' | 'PROP' | 'COMM';

/** Action of a Display Unit side key. */
export interface SoftAction {
  readonly side: 'L' | 'R';
  /** Key position, from top (0) to bottom (4). */
  readonly slot: number;
  readonly label: string;
  readonly run: () => void;
  readonly lit?: boolean;
  readonly disabled?: boolean;
  /**
   * One of several options (a mode): drawn gray while available and green while selected,
   * as the Free/LVLH/Intl/Auto keys of Orion's PFD. Without it, the key is an action (green).
   */
  readonly option?: boolean;
  readonly tone?: 'command';
  /** `data-press` value of the key: the tutorial points at it with the hand. */
  readonly press?: string;
}

/** Menu group: the ▲ key of each menu row switches between them. */
export type PageGroup = 'Flt' | 'Sys';

export interface PageDef {
  /** Title in Group.Page format, as on Orion's displays (Flt.PFD, Sys.Sum). */
  readonly title: string;
  /** Short tab label, mixed case like the cockpit's tabs. */
  readonly menu: string;
  readonly group: PageGroup;
  readonly Body: FC<{ s: SimState }>;
  readonly actions: (s: SimState) => SoftAction[];
}

const none = (): SoftAction[] => [];

export const PAGES: Readonly<Record<PageId, PageDef>> = {
  PFD: { title: 'Flt.PFD', menu: 'PFD', group: 'Flt', Body: Pfd, actions: pfdActions },
  TRAJ: { title: 'Flt.Traj', menu: 'Traj', group: 'Flt', Body: FlightTraj, actions: none },
  BURN: { title: 'Flt.Burn', menu: 'Burn', group: 'Flt', Body: Burn, actions: burnActions },
  PROCS: { title: 'Sys.Procs', menu: 'Procs', group: 'Flt', Body: Procs, actions: procsActions },
  TL: { title: 'Mission.Tl', menu: 'TL', group: 'Flt', Body: Timeline, actions: none },
  SUM: { title: 'Sys.Sum', menu: 'Sum', group: 'Sys', Body: SysSum, actions: none },
  FAULT: { title: 'Fault', menu: 'Fault', group: 'Sys', Body: Fault, actions: faultActions },
  PROP: { title: 'Prop.Sys', menu: 'Prop', group: 'Sys', Body: PropSys, actions: none },
  COMM: { title: 'Comm.Sum', menu: 'Comm', group: 'Sys', Body: CommSum, actions: none },
};

/** Tabs of each group, in menu order (after the ▲ key). Procs appears in both: it is the command interface. */
export const MENUS: Readonly<Record<PageGroup, readonly PageId[]>> = {
  Flt: ['PFD', 'TRAJ', 'BURN', 'PROCS', 'TL'],
  Sys: ['SUM', 'FAULT', 'PROP', 'COMM', 'PROCS'],
};
