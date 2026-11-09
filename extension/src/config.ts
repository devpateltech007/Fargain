/** Backend base URL, fixed at build time. Set VITE_BACKEND_URL when building for the deployed backend. */
export const BACKEND_URL: string = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';
