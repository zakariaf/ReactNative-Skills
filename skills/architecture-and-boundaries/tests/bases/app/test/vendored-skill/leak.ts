import TasksRoute from '../../src/app/index';
import { createSystemClockAdapter } from '@/services/clock/system-clock-adapter';

export const leak = [TasksRoute, createSystemClockAdapter];
