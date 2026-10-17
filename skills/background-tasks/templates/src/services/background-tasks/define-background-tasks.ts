// src/services/background-tasks/define-background-tasks.ts
// Defines every background job with the task manager, at import time, and nothing else (the
// background-tasks skill owns this file). The app entry (index.ts) imports it before
// 'expo-router/entry': on Android a run in a stopped process evaluates the bundle with the headless
// loader and renders no route, and a task the runtime finds undefined when it fires is unregistered
// for good (both read in the expo-task-manager 57 source).
// Each executor goes through toTaskExecutor, so no task can throw or outrun its budget unrecorded.
import * as TaskManager from 'expo-task-manager';

import { createBackgroundEnvironment } from './background-environment';
import { stopRunningJobs } from './background-job';
import { BACKGROUND_JOBS } from './background-jobs';
import { watchBackgroundExpiry } from './expo-background-tasks-adapter';
import { toTaskExecutor } from './task-executor';

for (const job of BACKGROUND_JOBS) {
  TaskManager.defineTask(job.name, toTaskExecutor(job, createBackgroundEnvironment));
}

// app-lifetime: one expiry listener for the whole process; it only ends the runs early.
watchBackgroundExpiry(stopRunningJobs);
