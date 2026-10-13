import { createContext } from 'svelte';
import type { TaskSaveGroup } from './task-autosave';

export const [getTaskSaves, setTaskSaves] = createContext<TaskSaveGroup>();
