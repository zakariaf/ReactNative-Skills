// src/api/raw-client.ts: planted (a skill template, not app code).
import axios from 'axios';

export const rawClient = axios.create({ baseURL: 'http://api.tasks.example' });
